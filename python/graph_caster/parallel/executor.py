# Copyright GraphCaster. All Rights Reserved.

"""Thread pool executor for parallel branch execution."""

from __future__ import annotations

import logging
import threading
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from typing import Any, Callable, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")


@dataclass
class ExecutorConfig:
    max_workers: int = 4
    thread_name_prefix: str = "gc-parallel"


@dataclass
class ExecutionResult:
    value: Any = None
    error: Exception | None = None
    duration_ms: float = 0.0

    @property
    def ok(self) -> bool:
        return self.error is None


class ParallelExecutor:
    """Thread pool executor for parallel graph branches."""

    def __init__(
        self,
        max_workers: int = 4,
        config: ExecutorConfig | None = None,
    ):
        if config:
            self._config = config
        else:
            self._config = ExecutorConfig(max_workers=max_workers)
        self._pool = ThreadPoolExecutor(
            max_workers=self._config.max_workers,
            thread_name_prefix=self._config.thread_name_prefix,
        )
        self._shutdown = False
        self._lock = threading.Lock()

    def submit(self, fn: Callable[..., T], *args: Any, **kwargs: Any) -> Future[T]:
        with self._lock:
            if self._shutdown:
                raise RuntimeError("Executor has been shut down")
            return self._pool.submit(fn, *args, **kwargs)

    def map(
        self,
        fn: Callable[[Any], T],
        items: list[Any],
        timeout: float | None = None,
    ) -> list[T]:
        futures = [self.submit(fn, item) for item in items]
        return [f.result(timeout=timeout) for f in futures]

    def shutdown(self, wait: bool = True) -> None:
        with self._lock:
            if self._shutdown:
                return
            self._shutdown = True
        self._pool.shutdown(wait=wait)
        logger.debug("ParallelExecutor shut down")

    def __enter__(self) -> ParallelExecutor:
        return self

    def __exit__(self, exc_type, exc_val, exc_tb) -> None:
        self.shutdown(wait=True)

    @property
    def max_workers(self) -> int:
        return self._config.max_workers
