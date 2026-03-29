# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import threading
import time
from collections import OrderedDict
from dataclasses import dataclass


@dataclass(frozen=True)
class _Entry:
    run_id: str
    viewer_token: str
    expires_at: float
    run_broker_phase: str
    run_broker_queue_position: int


class IdempotencyCache:
    """In-memory idempotency responses with TTL and bounded size (best-effort)."""

    def __init__(self, *, ttl_sec: float = 15 * 60, max_entries: int = 1024) -> None:
        self._ttl = ttl_sec
        self._max = max(1, max_entries)
        self._data: OrderedDict[str, _Entry] = OrderedDict()
        self._lock = threading.Lock()

    def get(
        self, key: str
    ) -> tuple[str, str, str, int] | None:
        now = time.monotonic()
        with self._lock:
            self._purge_expired_unlocked(now)
            ent = self._data.get(key)
            if ent is None or ent.expires_at <= now:
                return None
            self._data.move_to_end(key)
            return (
                ent.run_id,
                ent.viewer_token,
                ent.run_broker_phase,
                ent.run_broker_queue_position,
            )

    def remember(
        self,
        key: str,
        run_id: str,
        viewer_token: str,
        *,
        run_broker_phase: str,
        run_broker_queue_position: int,
    ) -> None:
        now = time.monotonic()
        with self._lock:
            self._purge_expired_unlocked(now)
            while len(self._data) >= self._max and key not in self._data:
                self._data.popitem(last=False)
            self._data[key] = _Entry(
                run_id=run_id,
                viewer_token=viewer_token,
                expires_at=now + self._ttl,
                run_broker_phase=run_broker_phase,
                run_broker_queue_position=run_broker_queue_position,
            )
            self._data.move_to_end(key)

    def _purge_expired_unlocked(self, now: float) -> None:
        dead = [k for k, v in self._data.items() if v.expires_at <= now]
        for k in dead:
            del self._data[k]
