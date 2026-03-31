# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import threading
from contextlib import contextmanager
from typing import Generator


class RunConcurrencyGate:
    """Limits concurrent runs globally and per ``graph_id`` (in-process)."""

    def __init__(self, *, global_limit: int, per_graph_limit: int) -> None:
        self._global = threading.BoundedSemaphore(max(1, global_limit))
        self._per_cap = max(1, per_graph_limit)
        self._per_graph: dict[str, threading.BoundedSemaphore] = {}
        self._lock = threading.Lock()

    @contextmanager
    def acquire(self, graph_id: str) -> Generator[None, None, None]:
        gid = graph_id.strip() or "_"
        self._global.acquire()
        try:
            with self._lock:
                sem = self._per_graph.get(gid)
                if sem is None:
                    sem = threading.BoundedSemaphore(self._per_cap)
                    self._per_graph[gid] = sem
            sem.acquire()
            try:
                yield
            finally:
                sem.release()
        finally:
            self._global.release()
