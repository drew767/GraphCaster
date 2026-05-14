# Copyright Aura. All Rights Reserved.

"""WebSocket heartbeat manager for nginx proxy compatibility.

Pattern from n8n: ~60s keepalive prevents proxies from closing idle connections.
"""

from __future__ import annotations

import asyncio
import logging
import os
import threading
import time
from typing import Any, Awaitable, Callable

logger = logging.getLogger(__name__)


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    if raw is None or raw == "":
        return default
    try:
        return float(raw)
    except ValueError:
        return default


class ProcessHeartbeatSupervisor:
    """Escalating soft/term/kill supervisor for a subprocess that emits NDJSON.

    Levels (elapsed since last heartbeat):
      - soft_sec: emit a run.heartbeat.stalled event (no action on the process).
      - term_sec: call proc.terminate() (POSIX SIGTERM, Windows TerminateProcess).
      - kill_sec: call proc.kill() (POSIX SIGKILL, Windows TerminateProcess).

    The supervisor fires the *highest applicable* level on a given tick; intermediate
    levels are skipped when the observed gap already exceeds the next threshold.
    Each level fires at most once per stall window. ``heartbeat()`` resets the timer.

    On Windows ``terminate`` and ``kill`` both map to TerminateProcess. There is no
    SIGTERM/SIGKILL distinction at the OS level; both call sites here will run.
    """

    def __init__(
        self,
        proc: Any,
        *,
        run_id: str = "",
        emit_event: Callable[[dict], None] | None = None,
        soft_sec: float | None = None,
        term_sec: float | None = None,
        kill_sec: float | None = None,
        time_fn: Callable[[], float] = time.monotonic,
        poll_interval_sec: float = 0.5,
    ) -> None:
        soft = _env_float("GC_HEARTBEAT_SOFT_SEC", 15.0) if soft_sec is None else soft_sec
        term = _env_float("GC_HEARTBEAT_TERM_SEC", 30.0) if term_sec is None else term_sec
        kill = _env_float("GC_HEARTBEAT_KILL_SEC", 60.0) if kill_sec is None else kill_sec
        if not (soft < term < kill):
            raise ValueError(
                f"Heartbeat thresholds must satisfy soft < term < kill; "
                f"got soft={soft}, term={term}, kill={kill}"
            )
        self._proc = proc
        self._run_id = run_id
        self._emit_event = emit_event
        self._soft_sec = soft
        self._term_sec = term
        self._kill_sec = kill
        self._time_fn = time_fn
        self._poll_interval_sec = poll_interval_sec
        self._lock = threading.Lock()
        self._last_heartbeat = time_fn()
        self.soft_fired = False
        self.term_fired = False
        self.kill_fired = False
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()

    def heartbeat(self) -> None:
        with self._lock:
            self._last_heartbeat = self._time_fn()
            self.soft_fired = False
            self.term_fired = False
            self.kill_fired = False

    def tick(self) -> None:
        if self._proc.poll() is not None:
            return
        with self._lock:
            elapsed = self._time_fn() - self._last_heartbeat
        if elapsed >= self._kill_sec and not self.kill_fired:
            self.kill_fired = True
            try:
                self._proc.kill()
            except Exception as exc:
                logger.warning("ProcessHeartbeatSupervisor kill() failed: %s", exc)
            return
        if elapsed >= self._term_sec and not self.term_fired:
            self.term_fired = True
            try:
                self._proc.terminate()
            except Exception as exc:
                logger.warning("ProcessHeartbeatSupervisor terminate() failed: %s", exc)
            return
        if elapsed >= self._soft_sec and not self.soft_fired:
            self.soft_fired = True
            if self._emit_event is not None:
                try:
                    self._emit_event(
                        {
                            "type": "run.heartbeat.stalled",
                            "runId": self._run_id,
                            "elapsedSec": elapsed,
                        }
                    )
                except Exception as exc:
                    logger.warning("ProcessHeartbeatSupervisor emit_event failed: %s", exc)

    def start(self) -> None:
        if self._thread is not None:
            return
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run_loop, name=f"gc-heartbeat-{self._run_id or 'anon'}", daemon=True
        )
        self._thread.start()

    def stop(self, timeout: float | None = None) -> None:
        self._stop_event.set()
        thread = self._thread
        if thread is not None:
            thread.join(timeout=timeout)
            self._thread = None

    def _run_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                self.tick()
            except Exception as exc:
                logger.warning("ProcessHeartbeatSupervisor tick() raised: %s", exc)
            if self.kill_fired:
                break
            self._stop_event.wait(self._poll_interval_sec)


class HeartbeatManager:
    """Manages periodic heartbeat/ping for WebSocket and SSE connections.

    Pattern from n8n: ~60s keepalive for nginx proxy compatibility.
    """

    def __init__(
        self,
        interval_sec: float = 60.0,
        send_ping: Callable[[], Awaitable[None]] | None = None,
    ):
        self.interval_sec = interval_sec
        self._send_ping = send_ping
        self._task: asyncio.Task[None] | None = None
        self._stop_event = asyncio.Event()

    async def start(self) -> None:
        """Start heartbeat loop."""
        if self._task is not None:
            return
        self._stop_event.clear()
        self._task = asyncio.create_task(self._ping_loop())

    async def stop(self) -> None:
        """Stop heartbeat loop."""
        if self._task is None:
            return
        self._stop_event.set()
        self._task.cancel()
        try:
            await self._task
        except asyncio.CancelledError:
            pass
        self._task = None

    async def _ping_loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                await asyncio.wait_for(
                    self._stop_event.wait(),
                    timeout=self.interval_sec,
                )
                break
            except asyncio.TimeoutError:
                if self._send_ping:
                    try:
                        await self._send_ping()
                    except Exception as e:
                        logger.debug("Heartbeat ping failed: %s", e)
