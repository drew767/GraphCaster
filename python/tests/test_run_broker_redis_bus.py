# Copyright GraphCaster. All Rights Reserved.

"""Tests for F90 — RedisEventBus (redis pub/sub + Streams event bus).

All tests use ``fakeredis.aioredis`` so no live Redis server is required.
The fakeredis package must be installed (added to dev extras in pyproject.toml).
"""

from __future__ import annotations

import asyncio
import json
import os

import pytest

try:
    import fakeredis.aioredis as fake_aioredis
    HAS_FAKEREDIS = True
except ImportError:
    HAS_FAKEREDIS = False

from graph_caster.run_broker_redis_bus import (
    RedisEventBus,
    _GLOBAL_METRICS,
    _backpressure_line,
    redis_bus_health,
    redis_bus_metrics_text,
    reset_event_bus,
)

pytestmark = [
    pytest.mark.anyio,
    pytest.mark.skipif(not HAS_FAKEREDIS, reason="fakeredis not installed"),
]


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _reset_metrics():
    """Reset global metrics state before every test."""
    reset_event_bus()
    yield
    reset_event_bus()


@pytest.fixture
def fake_redis():
    """Return a fakeredis async server instance shared across connections in a test."""
    return fake_aioredis.FakeServer()


async def _make_bus(fake_server) -> RedisEventBus:
    """Create a RedisEventBus backed by fakeredis."""
    bus = RedisEventBus.__new__(RedisEventBus)
    bus._url = "redis://localhost:6379/0"
    bus._prefix = "gc:events"
    bus._ttl = 3600
    bus._closed = False

    client = fake_aioredis.FakeRedis(server=fake_server, decode_responses=True)
    bus._pub_client = client
    bus._new_sub_client = lambda: fake_aioredis.FakeRedis(server=fake_server, decode_responses=True)
    return bus


# ---------------------------------------------------------------------------
# Helper: subscribe and collect N events then cancel
# ---------------------------------------------------------------------------

async def _collect(bus: RedisEventBus, run_id: str, n: int, timeout: float = 3.0) -> list[dict]:
    collected: list[dict] = []

    async def reader():
        async for event in bus.subscribe(run_id):
            collected.append(event)
            if len(collected) >= n:
                break

    task = asyncio.create_task(reader())
    try:
        await asyncio.wait_for(task, timeout=timeout)
    except asyncio.TimeoutError:
        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass
    return collected


# ---------------------------------------------------------------------------
# Basic publish / subscribe round-trip
# ---------------------------------------------------------------------------


async def test_publish_subscribe_roundtrip(fake_redis) -> None:
    bus = await _make_bus(fake_redis)
    run_id = "run-001"
    event = {"type": "node_started", "nodeId": "n1"}

    subscribe_task = asyncio.create_task(_collect(bus, run_id, n=1))
    await asyncio.sleep(0.05)  # let the subscriber register

    await bus.publish(run_id, event)

    results = await asyncio.wait_for(subscribe_task, timeout=3.0)
    assert len(results) == 1
    assert results[0]["type"] == "node_started"
    assert results[0]["nodeId"] == "n1"


async def test_publish_multiple_events(fake_redis) -> None:
    bus = await _make_bus(fake_redis)
    run_id = "run-002"
    events = [{"type": "e", "i": i} for i in range(5)]

    subscribe_task = asyncio.create_task(_collect(bus, run_id, n=5))
    await asyncio.sleep(0.05)

    for ev in events:
        await bus.publish(run_id, ev)

    results = await asyncio.wait_for(subscribe_task, timeout=3.0)
    assert len(results) == 5
    assert [r["i"] for r in results] == list(range(5))


# ---------------------------------------------------------------------------
# Replay: publish 5 events, then late subscriber gets all 5 + subsequent
# ---------------------------------------------------------------------------


async def test_replay_historical_events(fake_redis) -> None:
    bus = await _make_bus(fake_redis)
    run_id = "run-replay-001"

    events = [{"type": "step", "n": i} for i in range(5)]
    for ev in events:
        await bus.publish(run_id, ev)

    # Collect via replay only (no live subscribe needed for this assertion)
    collected: list[dict] = []
    async for event in bus.replay(run_id):
        collected.append(event)

    assert len(collected) == 5
    assert [e["n"] for e in collected] == list(range(5))


async def test_replay_since_filters_old(fake_redis) -> None:
    """replay(since=id) should return only entries AFTER the given id."""
    bus = await _make_bus(fake_redis)
    run_id = "run-replay-002"
    stream_key = bus._stream_key(run_id)
    r = bus._pub_client

    # Publish 3 events and note the stream ID after the second
    for i in range(3):
        await bus.publish(run_id, {"type": "step", "n": i})

    # Fetch raw stream entries to get the second entry's ID
    entries = await r.xrange(stream_key, min="-", max="+")
    assert len(entries) == 3
    second_id = entries[1][0]  # ID of 2nd entry (0-indexed)

    # Replay from 2nd id — should only return 3rd event
    collected: list[dict] = []
    async for event in bus.replay(run_id, since=second_id):
        collected.append(event)

    assert len(collected) == 1
    assert collected[0]["n"] == 2


async def test_late_subscriber_gets_history(fake_redis) -> None:
    """subscribe_with_replay delivers historical + subsequent events."""
    bus = await _make_bus(fake_redis)
    run_id = "run-late-001"

    # Pre-publish 3 historical events
    for i in range(3):
        await bus.publish(run_id, {"type": "hist", "n": i})

    # Start subscribe_with_replay (should first replay 3, then wait for live)
    collected: list[dict] = []

    async def late_reader():
        async for event in bus.subscribe_with_replay(run_id):
            collected.append(event)
            if len(collected) >= 4:
                break

    task = asyncio.create_task(late_reader())
    await asyncio.sleep(0.1)  # let the replay complete and enter live phase

    # Publish one more live event
    await bus.publish(run_id, {"type": "live", "n": 3})

    await asyncio.wait_for(task, timeout=3.0)
    assert len(collected) == 4
    # First 3 are historical
    for i in range(3):
        assert collected[i]["type"] == "hist"
        assert collected[i]["n"] == i
    # 4th is live
    assert collected[3]["type"] == "live"


# ---------------------------------------------------------------------------
# Health check transitions
# ---------------------------------------------------------------------------


async def test_health_ok_when_no_failures(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_RUN_BROKER_REDIS_URL", "redis://localhost/0")
    monkeypatch.setenv("GC_RUN_BROKER_REDIS_EVENT_BUS", "on")
    # No failures recorded — health should be ok
    assert redis_bus_health() == "ok"


async def test_health_degraded_after_failures(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_RUN_BROKER_REDIS_URL", "redis://localhost/0")
    monkeypatch.setenv("GC_RUN_BROKER_REDIS_EVENT_BUS", "on")
    # Simulate a publish failure
    _GLOBAL_METRICS.record_publish_error()
    assert redis_bus_health() == "degraded"


async def test_health_off_when_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GC_RUN_BROKER_REDIS_EVENT_BUS", raising=False)
    assert redis_bus_health() == "off"


async def test_health_off_when_url_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GC_RUN_BROKER_REDIS_URL", raising=False)
    monkeypatch.setenv("GC_RUN_BROKER_REDIS_EVENT_BUS", "on")
    assert redis_bus_health() == "off"


# ---------------------------------------------------------------------------
# Prometheus metrics
# ---------------------------------------------------------------------------


async def test_metrics_text_structure(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_RUN_BROKER_REDIS_URL", "redis://localhost/0")
    monkeypatch.setenv("GC_RUN_BROKER_REDIS_EVENT_BUS", "on")
    _GLOBAL_METRICS.record_publish_success()
    _GLOBAL_METRICS.record_publish_success()
    _GLOBAL_METRICS.record_publish_error()
    _GLOBAL_METRICS.record_replay()

    text = redis_bus_metrics_text()
    assert "gc_redis_bus_published_total" in text
    assert 'result="success"} 2' in text
    assert 'result="error"} 1' in text
    assert "gc_redis_bus_replay_count_total 1" in text
    assert "gc_redis_bus_subscribers_active" in text


# ---------------------------------------------------------------------------
# Backpressure: slow subscriber drops oldest, inserts stream_backpressure event
# ---------------------------------------------------------------------------


async def test_backpressure_slow_subscriber(fake_redis) -> None:
    """When the subscriber queue is full, the oldest event is dropped and a
    stream_backpressure sentinel is inserted.

    We patch _BUS_QUEUE_DEPTH to 3 BEFORE the subscriber starts so the
    asyncio.Queue inside subscribe() is created with that small maxsize.
    """
    import graph_caster.run_broker_redis_bus as _bus_mod

    _orig = _bus_mod._BUS_QUEUE_DEPTH
    _bus_mod._BUS_QUEUE_DEPTH = 3
    try:
        bus = await _make_bus(fake_redis)
        run_id = "run-bp-001"

        collected: list[dict] = []
        overflow_reached = asyncio.Event()

        async def slow_reader():
            async for event in bus.subscribe(run_id):
                collected.append(event)
                if event.get("type") == "stream_backpressure":
                    overflow_reached.set()
                    break
                # Block the consumer so the queue fills up
                await asyncio.sleep(0.05)

        task = asyncio.create_task(slow_reader())
        await asyncio.sleep(0.05)  # let subscriber register

        # Publish more events than the queue can hold
        for i in range(8):
            await bus.publish(run_id, {"type": "data", "i": i})

        try:
            await asyncio.wait_for(overflow_reached.wait(), timeout=5.0)
        except asyncio.TimeoutError:
            pass

        task.cancel()
        try:
            await task
        except (asyncio.CancelledError, Exception):
            pass

    finally:
        _bus_mod._BUS_QUEUE_DEPTH = _orig

    bp_events = [e for e in collected if e.get("type") == "stream_backpressure"]
    assert len(bp_events) >= 1, f"Expected at least one backpressure event, got: {collected}"
    assert bp_events[0]["reason"] == "redis_bus_queue_full"


# ---------------------------------------------------------------------------
# Metrics tracking: publish success / error counters
# ---------------------------------------------------------------------------


async def test_metrics_success_counter(fake_redis) -> None:
    bus = await _make_bus(fake_redis)
    run_id = "run-metrics-001"
    before = _GLOBAL_METRICS.published_success
    await bus.publish(run_id, {"type": "ping"})
    assert _GLOBAL_METRICS.published_success == before + 1


async def test_metrics_error_on_redis_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    """A Redis error increments the error counter and does not raise."""
    bus = RedisEventBus.__new__(RedisEventBus)
    bus._url = "redis://localhost/0"
    bus._prefix = "gc:events"
    bus._ttl = 3600
    bus._closed = False

    async def _fail(*args, **kwargs):
        raise ConnectionError("simulated Redis failure")

    class _FakeClient:
        async def publish(self, *a, **kw):
            raise ConnectionError("boom")

        async def xadd(self, *a, **kw):
            raise ConnectionError("boom")

        async def expire(self, *a, **kw):
            raise ConnectionError("boom")

        async def aclose(self):
            pass

    bus._pub_client = _FakeClient()
    bus._new_sub_client = lambda: _FakeClient()

    before_err = _GLOBAL_METRICS.published_error
    await bus.publish("run-err", {"type": "test"})  # must not raise
    assert _GLOBAL_METRICS.published_error == before_err + 1


# ---------------------------------------------------------------------------
# Replay count metric
# ---------------------------------------------------------------------------


async def test_replay_increments_counter(fake_redis) -> None:
    bus = await _make_bus(fake_redis)
    run_id = "run-replay-counter"
    await bus.publish(run_id, {"type": "a"})
    await bus.publish(run_id, {"type": "b"})

    before = _GLOBAL_METRICS.replay_count
    collected = []
    async for ev in bus.replay(run_id):
        collected.append(ev)

    assert _GLOBAL_METRICS.replay_count == before + 2
    assert len(collected) == 2


# ---------------------------------------------------------------------------
# Bus is no-op when feature gate is off
# ---------------------------------------------------------------------------


async def test_no_op_when_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GC_RUN_BROKER_REDIS_URL", raising=False)
    monkeypatch.delenv("GC_RUN_BROKER_REDIS_EVENT_BUS", raising=False)
    from graph_caster.run_broker_redis_bus import get_event_bus
    bus = await get_event_bus()
    assert bus is None


# ---------------------------------------------------------------------------
# run_sessions.py: worker_id field present
# ---------------------------------------------------------------------------


def test_run_session_has_worker_id(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_RUN_BROKER_INSTANCE_ID", "broker-b")
    from graph_caster.run_sessions import RunSession
    s = RunSession(run_id="r1", root_graph_id="g1")
    assert s.worker_id == "broker-b"


def test_run_session_worker_id_default_to_hostname() -> None:
    from graph_caster.run_sessions import RunSession
    import socket
    s = RunSession(run_id="r2", root_graph_id="g2")
    assert s.worker_id  # non-empty
    assert s.worker_id in (socket.gethostname(), "unknown")
