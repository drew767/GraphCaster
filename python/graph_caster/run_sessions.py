# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import threading
from dataclasses import dataclass, field
import os
from datetime import UTC, datetime, timedelta
from typing import Literal

RunTerminalStatus = Literal["success", "failed", "cancelled", "partial"]
RunSessionStatus = Literal["running"] | RunTerminalStatus


@dataclass(slots=True)
class RunSession:
    run_id: str
    root_graph_id: str
    started_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    finished_at: datetime | None = None
    status: RunSessionStatus = "running"
    cancel_event: threading.Event = field(default_factory=threading.Event)


class RunSessionRegistry:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._sessions: dict[str, RunSession] = {}

    def register(self, session: RunSession) -> None:
        with self._lock:
            existing = self._sessions.get(session.run_id)
            if existing is not None and existing.status == "running":
                raise ValueError(f"run_id already has an active session: {session.run_id!r}")
            self._sessions[session.run_id] = session

    def complete(self, run_id: str, status: RunTerminalStatus) -> None:
        with self._lock:
            s = self._sessions.get(run_id)
            if s is None:
                return
            s.finished_at = datetime.now(UTC)
            s.status = status

    def get(self, run_id: str) -> RunSession | None:
        with self._lock:
            return self._sessions.get(run_id)

    def request_cancel(self, run_id: str) -> bool:
        with self._lock:
            s = self._sessions.get(run_id)
            if s is None or s.status != "running":
                return False
            s.cancel_event.set()
            return True

    def running_sessions(self) -> list[RunSession]:
        with self._lock:
            return [s for s in self._sessions.values() if s.status == "running"]

    def reap_stale_running_sessions(
        self,
        *,
        max_age_sec: float | None = None,
        terminal_status: RunTerminalStatus = "failed",
    ) -> list[str]:
        """
        Mark very old ``running`` sessions as terminal (host crash / leak safety net).
        Default max age: ``GC_RUN_SESSION_REAP_SEC`` or 4 hours.
        """
        if max_age_sec is None:
            raw = os.environ.get("GC_RUN_SESSION_REAP_SEC", "14400").strip()
            try:
                max_age_sec = float(raw)
            except ValueError:
                max_age_sec = 14_400.0
        max_age_sec = max(60.0, float(max_age_sec))
        cutoff = datetime.now(UTC) - timedelta(seconds=max_age_sec)
        reaped: list[str] = []
        with self._lock:
            for rid, s in list(self._sessions.items()):
                if s.status != "running":
                    continue
                if s.started_at >= cutoff:
                    continue
                s.finished_at = datetime.now(UTC)
                s.status = terminal_status
                reaped.append(rid)
        return reaped


_default_registry_lock = threading.Lock()
_default_registry: RunSessionRegistry | None = None


def get_default_run_registry() -> RunSessionRegistry:
    global _default_registry
    with _default_registry_lock:
        if _default_registry is None:
            _default_registry = RunSessionRegistry()
        return _default_registry


def reset_default_run_registry() -> None:
    global _default_registry
    with _default_registry_lock:
        _default_registry = None
