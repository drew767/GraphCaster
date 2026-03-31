# Copyright GraphCaster. All Rights Reserved.

"""Thread pool for parallel task execution (roadmap WorkerPool)."""

from __future__ import annotations

import queue
import threading
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Callable, TypeVar

if TYPE_CHECKING:
    from graph_caster.execution.worker_coordinator import WorkerCoordinator

T = TypeVar("T")


@dataclass
class TaskResult:
    """Result of a worker task."""

    task_id: str
    result: Any | None = None
    error: Exception | None = None


class WorkerPool:
    """Thread-pool facade with explicit start/stop and aggregate wait.

    Optional :class:`~graph_caster.execution.worker_coordinator.WorkerCoordinator`
    acquires a per-``task_id`` lease before **submit** and releases it when the task
    finishes (for cross-host slot caps).
    """

    def __init__(
        self,
        max_workers: int = 4,
        *,
        slot_coordinator: WorkerCoordinator | None = None,
        coordinator_slot_ttl_sec: int = 3600,
    ) -> None:
        self._max_workers = max_workers
        self._slot_coordinator = slot_coordinator
        self._coord_ttl = max(1, int(coordinator_slot_ttl_sec))
        self._executor: ThreadPoolExecutor | None = None
        self._futures: dict[str, Future[Any]] = {}
        self._results: queue.Queue[TaskResult] = queue.Queue()
        self._lock = threading.Lock()

    @property
    def max_workers(self) -> int:
        return self._max_workers

    def in_flight_count(self) -> int:
        """Futures from :meth:`submit` that are not yet **done** (running or pending)."""

        with self._lock:
            return sum(1 for f in self._futures.values() if not f.done())

    def start(self) -> None:
        self._executor = ThreadPoolExecutor(max_workers=self._max_workers)

    def stop(self) -> None:
        if self._executor:
            self._executor.shutdown(wait=True)
            self._executor = None

    def submit(
        self,
        task_id: str,
        fn: Callable[..., T],
        *args: Any,
        **kwargs: Any,
    ) -> None:
        if not self._executor:
            raise RuntimeError("WorkerPool not started")

        coord_tok: str | None = None
        if self._slot_coordinator is not None:
            coord_tok = self._slot_coordinator.acquire_slot(task_id, ttl_sec=self._coord_ttl)
            if coord_tok is None:
                raise RuntimeError("worker coordinator slot acquire failed")

        def wrapped() -> None:
            try:
                try:
                    out = fn(*args, **kwargs)
                    self._results.put(TaskResult(task_id=task_id, result=out))
                except Exception as e:
                    self._results.put(TaskResult(task_id=task_id, error=e))
            finally:
                if self._slot_coordinator is not None and coord_tok is not None:
                    self._slot_coordinator.release_slot(task_id, coord_tok)

        try:
            fut = self._executor.submit(wrapped)
        except Exception:
            if self._slot_coordinator is not None and coord_tok is not None:
                self._slot_coordinator.release_slot(task_id, coord_tok)
            raise
        with self._lock:
            self._futures[task_id] = fut

    def wait_all(self, timeout: float | None = None) -> None:
        with self._lock:
            futures = list(self._futures.values())
        for f in futures:
            f.result(timeout=timeout)

    def poll_result(self, timeout: float = 0.0) -> TaskResult | None:
        try:
            return self._results.get(timeout=timeout)
        except queue.Empty:
            return None
