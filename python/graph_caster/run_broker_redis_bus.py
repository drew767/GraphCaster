# Copyright GraphCaster. All Rights Reserved.

"""Redis pub/sub + Streams event bus for SSE fan-out across multiple broker workers (F90).

Feature gate: set ``GC_RUN_BROKER_REDIS_URL`` and ``GC_RUN_BROKER_REDIS_EVENT_BUS=on``.
When the gate is off the bus is a no-op and the broker behaves identically to a single-worker
deployment.

Architecture
------------
- **publish**: PUBLISH on ``{prefix}:{run_id}`` (instant delivery) AND
  XADD on ``{prefix}:stream:{run_id}`` (persistence for late subscribers).
- **subscribe**: opens an async pubsub listener; yields JSON-decoded event dicts until cancelled.
- **replay**: XRANGE over the stream key from *since* (last consumed stream ID, or ``"-"``
  for full history), yielding historic events before the live subscription.
- Backpressure: per-subscriber in-memory asyncio.Queue capped at 1 024 items; overflow drops
  oldest and inserts a ``stream_backpressure`` sentinel consistent with the broadcaster's
  existing contract.
- Health: ``redis_bus_health()`` returns ``"ok" | "degraded" | "off"``.
  Degraded when publish failures > 0 in the last 60 s (tracked in memory).
- Prometheus: four new metric families exposed via ``redis_bus_metrics_text()``.
"""

from __future__ import annotations

import asyncio
import collections
import json
import logging
import os
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Literal

_LOG = logging.getLogger(__name__)

_BUS_QUEUE_DEPTH = 1024
_HEALTH_WINDOW_SEC = 60.0
_DEFAULT_STREAM_TTL_SEC = 3600

HealthState = Literal["ok", "degraded", "off"]


# ---------------------------------------------------------------------------
# Prometheus counters (in-memory, no extra deps)
# ---------------------------------------------------------------------------

@dataclass
class _BusMetrics:
    published_success: int = 0
    published_error: int = 0
    replay_count: int = 0
    # gauge: number of active async subscribers
    subscribers_active: int = 0
    # sliding window of failure timestamps for health check
    failure_timestamps: collections.deque = field(
        default_factory=lambda: collections.deque()
    )

    def record_publish_success(self) -> None:
        self.published_success += 1

    def record_publish_error(self) -> None:
        self.published_error += 1
        self.failure_timestamps.append(time.monotonic())

    def record_replay(self) -> None:
        self.replay_count += 1

    def failures_in_last_minute(self) -> int:
        cutoff = time.monotonic() - _HEALTH_WINDOW_SEC
        while self.failure_timestamps and self.failure_timestamps[0] < cutoff:
            self.failure_timestamps.popleft()
        return len(self.failure_timestamps)

    def health(self) -> HealthState:
        return "degraded" if self.failures_in_last_minute() > 0 else "ok"


_GLOBAL_METRICS = _BusMetrics()

# Module-level counter for relay/fanout OSError visibility.  Incremented every time a fanout publish
# silently fails due to Redis being down (OSError or its subclasses, e.g. ``ConnectionError``).
# Exposed via :func:`get_redis_relay_failure_count` for tests and monitoring.
_redis_relay_failures = 0


def get_redis_relay_failure_count() -> int:
    """Total relay-fanout publish failures observed since process start (OSError family)."""
    return _redis_relay_failures


def reset_redis_relay_failure_count() -> None:
    """Reset the relay-fanout failure counter (for tests only)."""
    global _redis_relay_failures
    _redis_relay_failures = 0


def _record_relay_failure(run_id: str, error: BaseException) -> None:
    """Increment the relay failure counter and emit a WARN-level structured log line."""
    global _redis_relay_failures
    _redis_relay_failures += 1
    _LOG.warning(
        "redis_bus_relay_fanout_failed",
        extra={"run_id": run_id, "error_class": type(error).__name__, "error": str(error)},
        exc_info=error,
    )


def redis_bus_metrics_text() -> str:
    """Prometheus text exposition for F90 metrics (appended to /metrics response)."""
    m = _GLOBAL_METRICS
    lines = [
        "# HELP gc_redis_bus_published_total Events published to Redis event bus.",
        "# TYPE gc_redis_bus_published_total counter",
        f'gc_redis_bus_published_total{{result="success"}} {m.published_success}',
        f'gc_redis_bus_published_total{{result="error"}} {m.published_error}',
        "# HELP gc_redis_bus_subscribers_active Active async subscribers on the event bus.",
        "# TYPE gc_redis_bus_subscribers_active gauge",
        f"gc_redis_bus_subscribers_active {m.subscribers_active}",
        "# HELP gc_redis_bus_replay_count_total Events delivered via replay (stream history).",
        "# TYPE gc_redis_bus_replay_count_total counter",
        f"gc_redis_bus_replay_count_total {m.replay_count}",
        "# HELP gc_redis_stream_age_seconds_bucket Not yet sampled (future histogram).",
        "# TYPE gc_redis_stream_age_seconds_bucket gauge",
        "gc_redis_stream_age_seconds_bucket 0",
        "",
    ]
    return "\n".join(lines)


def redis_bus_health() -> HealthState:
    """``"off"`` when env gate is disabled; ``"ok"`` or ``"degraded"`` otherwise."""
    if not _event_bus_enabled():
        return "off"
    return _GLOBAL_METRICS.health()


# ---------------------------------------------------------------------------
# Configuration helpers
# ---------------------------------------------------------------------------

def _event_bus_enabled() -> bool:
    url = os.environ.get("GC_RUN_BROKER_REDIS_URL", "").strip()
    if not url:
        return False
    flag = os.environ.get("GC_RUN_BROKER_REDIS_EVENT_BUS", "").strip().lower()
    return flag in ("1", "true", "yes", "on")


def _stream_ttl() -> int:
    raw = os.environ.get("GC_REDIS_STREAM_TTL_SEC", "").strip()
    if raw:
        try:
            return max(60, int(raw))
        except ValueError:
            pass
    return _DEFAULT_STREAM_TTL_SEC


def _backpressure_line(run_id: str, dropped: int) -> dict:
    return {
        "type": "stream_backpressure",
        "runId": run_id,
        "droppedOutputLines": dropped,
        "reason": "redis_bus_queue_full",
    }


# ---------------------------------------------------------------------------
# RedisEventBus
# ---------------------------------------------------------------------------

class RedisEventBus:
    """Async Redis pub/sub + Streams event bus for cross-broker SSE fan-out.

    All public methods are coroutine-safe. Redis errors are caught and logged;
    they never propagate to callers (non-crashing contract).

    Usage pattern (publisher side — in broadcaster hook)::

        bus = RedisEventBus(redis_url)
        await bus.publish(run_id, {"type": "node_started", ...})

    Usage pattern (SSE/WS subscriber side)::

        async for event in bus.subscribe_with_replay(run_id, since=last_id):
            yield event

    Parameters
    ----------
    redis_url:
        Full Redis URL, e.g. ``redis://localhost:6379/0``.
    key_prefix:
        Namespace for channel and stream keys (default ``"gc:events"``).
    """

    def __init__(
        self,
        redis_url: str,
        *,
        key_prefix: str = "gc:events",
        stream_ttl_sec: int | None = None,
    ) -> None:
        self._url = redis_url
        self._prefix = key_prefix
        self._ttl = stream_ttl_sec if stream_ttl_sec is not None else _stream_ttl()
        self._pub_client: object | None = None
        self._closed = False

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _channel(self, run_id: str) -> str:
        return f"{self._prefix}:{run_id}"

    def _stream_key(self, run_id: str) -> str:
        return f"{self._prefix}:stream:{run_id}"

    async def _get_pub_client(self):
        """Lazy-init a shared async Redis client for publish operations."""
        if self._pub_client is None:
            try:
                import redis.asyncio as aioredis
            except ImportError as exc:
                raise RuntimeError(
                    "GC_RUN_BROKER_REDIS_EVENT_BUS=on requires 'redis' package; "
                    "pip install 'graph-caster[redis]'"
                ) from exc
            self._pub_client = aioredis.from_url(self._url, decode_responses=True)
        return self._pub_client

    async def _new_sub_client(self):
        """Return a *fresh* async Redis client for a subscribe call (pubsub needs its own conn)."""
        try:
            import redis.asyncio as aioredis
        except ImportError as exc:
            raise RuntimeError(
                "GC_RUN_BROKER_REDIS_EVENT_BUS=on requires 'redis' package"
            ) from exc
        return aioredis.from_url(self._url, decode_responses=True)

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def publish(self, run_id: str, event: dict) -> None:
        """Publish *event* to the pub/sub channel and append to the Redis Stream.

        Both operations are best-effort: failures are logged and counted for health
        tracking but never re-raised. ``OSError``-family failures additionally bump the
        relay-failure counter (see :func:`get_redis_relay_failure_count`) so an
        unreachable Redis is visible to monitoring even when no caller checks the
        publish return value.
        """
        payload = json.dumps(event, separators=(",", ":"))
        # Retry transient OS-level errors with bounded backoff (3 attempts at 0.1s/0.5s/2s) before
        # giving up and recording a relay failure.
        backoff = (0.1, 0.5, 2.0)
        last_exc: BaseException | None = None
        for attempt, delay in enumerate(backoff):
            try:
                r = await self._get_pub_client()
                channel = self._channel(run_id)
                stream_key = self._stream_key(run_id)
                # Publish for live subscribers
                await r.publish(channel, payload)
                # Append to stream for replay (MAXLEN ~ 10 000 per run to bound memory)
                await r.xadd(stream_key, {"e": payload}, maxlen=10_000, approximate=True)
                # Set/refresh TTL on the stream key
                await r.expire(stream_key, self._ttl)
                _GLOBAL_METRICS.record_publish_success()
                return
            except OSError as exc:
                last_exc = exc
                if attempt < len(backoff) - 1:
                    await asyncio.sleep(delay)
                    continue
                break
            except Exception as exc:
                last_exc = exc
                break

        _GLOBAL_METRICS.record_publish_error()
        if isinstance(last_exc, OSError):
            _record_relay_failure(run_id, last_exc)
        else:
            _LOG.warning(
                "RedisEventBus.publish failed for run %s",
                run_id,
                exc_info=last_exc,
            )

    async def subscribe(self, run_id: str) -> AsyncIterator[dict]:
        """Live subscription via Redis pub/sub.

        Yields JSON-decoded event dicts until the coroutine is cancelled.
        Applies a 1 024-item backpressure queue; if full, drops oldest and inserts a
        ``stream_backpressure`` event.
        """
        q: asyncio.Queue[dict] = asyncio.Queue(maxsize=_BUS_QUEUE_DEPTH)
        _GLOBAL_METRICS.subscribers_active += 1
        client = await self._new_sub_client()
        try:
            pubsub = client.pubsub()
            await pubsub.subscribe(self._channel(run_id))
            dropped = 0

            async def _reader() -> None:
                nonlocal dropped
                try:
                    async for raw_msg in pubsub.listen():
                        if raw_msg["type"] != "message":
                            continue
                        data = raw_msg["data"]
                        if isinstance(data, bytes):
                            data = data.decode("utf-8")
                        try:
                            event = json.loads(data)
                        except json.JSONDecodeError:
                            continue
                        if q.full():
                            # Drop the oldest item to make room
                            try:
                                q.get_nowait()
                                dropped += 1
                            except asyncio.QueueEmpty:
                                pass
                            await q.put(_backpressure_line(run_id, dropped))
                            dropped = 0
                        await q.put(event)
                except asyncio.CancelledError:
                    pass
                except Exception:
                    _LOG.debug("RedisEventBus subscribe reader error", exc_info=True)

            reader_task = asyncio.create_task(_reader())
            try:
                while True:
                    event = await q.get()
                    yield event
            finally:
                reader_task.cancel()
                try:
                    await reader_task
                except (asyncio.CancelledError, Exception):
                    pass
                try:
                    await pubsub.unsubscribe(self._channel(run_id))
                    await pubsub.aclose()
                except Exception:
                    pass
        finally:
            _GLOBAL_METRICS.subscribers_active -= 1
            try:
                await client.aclose()
            except Exception:
                pass

    async def replay(
        self,
        run_id: str,
        *,
        since: str | None = None,
    ) -> AsyncIterator[dict]:
        """Read persisted events from the Redis Stream for late subscribers.

        Parameters
        ----------
        since:
            Last consumed stream entry ID (exclusive lower bound).  The entry with
            this ID is NOT yielded — only strictly newer entries are returned.
            Pass ``None`` or ``"-"`` to read from the beginning of the stream.
        """
        if since and since != "-":
            # Use exclusive lower bound: Redis 6.2+ supports "(id" prefix in XRANGE.
            # fakeredis also supports this syntax.
            start = f"({since}"
        else:
            start = "-"
        try:
            r = await self._get_pub_client()
            stream_key = self._stream_key(run_id)
            entries = await r.xrange(stream_key, min=start, max="+")
            for entry_id, fields in entries:
                raw = fields.get("e", "")
                try:
                    event = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                _GLOBAL_METRICS.record_replay()
                yield event
        except Exception:
            _LOG.warning("RedisEventBus.replay failed for run %s", run_id, exc_info=True)

    async def subscribe_with_replay(
        self,
        run_id: str,
        *,
        since: str | None = None,
    ) -> AsyncIterator[dict]:
        """Replay historic events then continue with live subscription.

        Intended for SSE/WS handlers serving late-connecting clients.
        """
        async for event in self.replay(run_id, since=since):
            yield event
        async for event in self.subscribe(run_id):
            yield event

    async def close(self) -> None:
        """Close the shared publish client."""
        self._closed = True
        if self._pub_client is not None:
            try:
                await self._pub_client.aclose()
            except Exception:
                pass
            self._pub_client = None


# ---------------------------------------------------------------------------
# Module-level singleton (created lazily when the feature is on)
# ---------------------------------------------------------------------------

_bus_singleton: RedisEventBus | None = None
_bus_lock = asyncio.Lock()


async def get_event_bus() -> RedisEventBus | None:
    """Return the singleton :class:`RedisEventBus`, or ``None`` if feature is off."""
    global _bus_singleton
    if not _event_bus_enabled():
        return None
    if _bus_singleton is not None:
        return _bus_singleton
    async with _bus_lock:
        if _bus_singleton is None:
            url = os.environ.get("GC_RUN_BROKER_REDIS_URL", "").strip()
            _bus_singleton = RedisEventBus(url)
    return _bus_singleton


def reset_event_bus() -> None:
    """Reset the singleton (for tests)."""
    global _bus_singleton
    _bus_singleton = None
    _GLOBAL_METRICS.published_success = 0
    _GLOBAL_METRICS.published_error = 0
    _GLOBAL_METRICS.replay_count = 0
    _GLOBAL_METRICS.subscribers_active = 0
    _GLOBAL_METRICS.failure_timestamps.clear()
    reset_redis_relay_failure_count()


# ---------------------------------------------------------------------------
# Broadcaster integration hook (synchronous, called from RunBroadcaster.broadcast)
# ---------------------------------------------------------------------------

def make_redis_bus_fanout_hook(run_id: str, bus: "RedisEventBus"):
    """Return a *synchronous* relay hook that fires-and-forgets to the event bus.

    The hook submits an asyncio task on the running event loop so it doesn't block
    the broadcaster thread. If there is no running event loop the publish is skipped
    (test or shutdown edge case).
    """
    import json as _json

    def _hook(msg) -> None:
        event: dict
        if msg.kind == "out":
            raw = str(msg.payload)
            try:
                event = _json.loads(raw)
            except _json.JSONDecodeError:
                event = {"type": "process_output", "line": raw}
        elif msg.kind == "err":
            raw = str(msg.payload)
            try:
                event = _json.loads(raw)
            except _json.JSONDecodeError:
                event = {"type": "stderr", "line": raw}
        elif msg.kind == "exit":
            event = {"type": "run_finished", "code": int(msg.payload)}
        else:
            return

        try:
            loop = asyncio.get_running_loop()
            loop.create_task(bus.publish(run_id, event))
        except RuntimeError:
            pass  # no running loop; skip

    return _hook


# ---------------------------------------------------------------------------
# SSE integration helper
# ---------------------------------------------------------------------------

async def stream_run_from_bus(run_id: str, since: str | None = None) -> AsyncIterator[str]:
    """Yield SSE-formatted chunks from the Redis event bus for a remote run.

    This is used in the SSE handler when the run is NOT local to this worker.
    """
    bus = await get_event_bus()
    if bus is None:
        return

    async for event in bus.subscribe_with_replay(run_id, since=since):
        event_type = event.get("type", "")
        payload = json.dumps(event, separators=(",", ":"))

        if event_type == "run_finished":
            code = event.get("code", -1)
            yield f"event: exit\ndata: {json.dumps({'code': code})}\n\n"
            return
        elif event_type == "stderr":
            yield f"event: err\ndata: {payload}\n\n"
        else:
            for segment in payload.split("\n"):
                yield f"data: {segment}\n"
            yield "\n"
