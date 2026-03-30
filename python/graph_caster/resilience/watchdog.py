# Copyright GraphCaster. All Rights Reserved.

"""Worker health monitoring with timeout detection."""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Callable

logger = logging.getLogger(__name__)


class WorkerStatus(Enum):
    HEALTHY = "healthy"
    DEAD = "dead"
    UNKNOWN = "unknown"


class WorkerDeadError(Exception):
    """Raised when worker is detected as dead."""

    def __init__(self, worker_id: str, run_id: str | None):
        self.worker_id = worker_id
        self.run_id = run_id
        super().__init__(f"Worker {worker_id} is dead (run: {run_id})")


@dataclass
class WorkerInfo:
    worker_id: str
    timeout: float
    run_id: str | None
    last_heartbeat: float = field(default_factory=time.monotonic)
    status: WorkerStatus = WorkerStatus.HEALTHY


class WorkerWatchdog:
    """Monitor worker health via heartbeats."""

    def __init__(
        self,
        check_interval: float = 1.0,
        on_worker_dead: Callable[[str, str | None], None] | None = None,
    ):
        self.check_interval = check_interval
        self.on_worker_dead = on_worker_dead
        self._workers: dict[str, WorkerInfo] = {}
        self._lock = threading.RLock()
        self._stop_event = threading.Event()
        self._checker_thread: threading.Thread | None = None

    def start(self) -> None:
        if self._checker_thread is not None:
            return
        self._stop_event.clear()
        self._checker_thread = threading.Thread(
            target=self._checker_loop,
            daemon=True,
            name="watchdog-checker",
        )
        self._checker_thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._checker_thread is not None:
            self._checker_thread.join(timeout=5.0)
            self._checker_thread = None

    def register(
        self,
        worker_id: str,
        timeout: float,
        run_id: str | None = None,
    ) -> None:
        with self._lock:
            self._workers[worker_id] = WorkerInfo(
                worker_id=worker_id,
                timeout=timeout,
                run_id=run_id,
            )

    def unregister(self, worker_id: str) -> None:
        with self._lock:
            self._workers.pop(worker_id, None)

    def heartbeat(self, worker_id: str) -> None:
        with self._lock:
            if worker_id in self._workers:
                self._workers[worker_id].last_heartbeat = time.monotonic()
                self._workers[worker_id].status = WorkerStatus.HEALTHY

    def get_status(self, worker_id: str) -> WorkerStatus:
        with self._lock:
            info = self._workers.get(worker_id)
            if info is None:
                return WorkerStatus.UNKNOWN
            return info.status

    def _checker_loop(self) -> None:
        while not self._stop_event.is_set():
            self._check_workers()
            self._stop_event.wait(self.check_interval)

    def _check_workers(self) -> None:
        now = time.monotonic()
        dead_workers: list[WorkerInfo] = []
        with self._lock:
            for info in self._workers.values():
                if info.status == WorkerStatus.DEAD:
                    continue
                elapsed = now - info.last_heartbeat
                if elapsed > info.timeout:
                    info.status = WorkerStatus.DEAD
                    dead_workers.append(info)
                    logger.warning(
                        "Worker %s timed out (%.1fs > %.1fs)",
                        info.worker_id,
                        elapsed,
                        info.timeout,
                    )
        if self.on_worker_dead:
            for info in dead_workers:
                try:
                    self.on_worker_dead(info.worker_id, info.run_id)
                except Exception:
                    logger.exception("Error in on_worker_dead callback for %s", info.worker_id)
