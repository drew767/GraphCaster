# Copyright GraphCaster. All Rights Reserved.

"""Concurrency limiting for parallel execution."""

from __future__ import annotations

import threading
import uuid
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Generator


class LimitExceededError(Exception):
    def __init__(self, limit: int, resource: str):
        self.limit = limit
        self.resource = resource
        super().__init__(f"Concurrency limit ({limit}) exceeded for {resource}")


@dataclass
class AcquisitionToken:
    token_id: str
    resource: str


class ConcurrencyLimiter:
    def __init__(
        self,
        max_concurrent: int,
        timeout: float | None = None,
    ):
        self.max_concurrent = max_concurrent
        self.timeout = timeout
        self._semaphore = threading.Semaphore(max_concurrent)
        self._active: dict[str, AcquisitionToken] = {}
        self._lock = threading.Lock()

    @property
    def active_count(self) -> int:
        with self._lock:
            return len(self._active)

    def acquire(self, resource: str, timeout: float | None = None) -> AcquisitionToken:
        effective_timeout = timeout if timeout is not None else self.timeout
        acquired = self._semaphore.acquire(blocking=True, timeout=effective_timeout)
        if not acquired:
            raise LimitExceededError(self.max_concurrent, resource)
        token = AcquisitionToken(token_id=str(uuid.uuid4()), resource=resource)
        with self._lock:
            self._active[token.token_id] = token
        return token

    def release(self, token: AcquisitionToken) -> None:
        with self._lock:
            self._active.pop(token.token_id, None)
        self._semaphore.release()

    @contextmanager
    def slot(self, resource: str) -> Generator[AcquisitionToken, None, None]:
        token = self.acquire(resource)
        try:
            yield token
        finally:
            self.release(token)


@dataclass
class ResourceLimits:
    max_parallel_graphs: int = 4
    max_parallel_nodes_per_graph: int = 8
    max_total_nodes: int = 32

    def __post_init__(self) -> None:
        self._graph_limiter = ConcurrencyLimiter(max_concurrent=self.max_parallel_graphs)
        self._node_limiters: dict[str, ConcurrencyLimiter] = {}
        self._total_limiter = ConcurrencyLimiter(max_concurrent=self.max_total_nodes)
        self._lock = threading.Lock()

    def acquire_graph(self, graph_id: str, timeout: float | None = None) -> AcquisitionToken:
        return self._graph_limiter.acquire(graph_id, timeout=timeout)

    def release_graph(self, token: AcquisitionToken) -> None:
        graph_id = token.resource
        with self._lock:
            self._node_limiters.pop(graph_id, None)
        self._graph_limiter.release(token)

    def acquire_node(
        self,
        graph_id: str,
        node_id: str,
        timeout: float | None = None,
    ) -> tuple[AcquisitionToken, AcquisitionToken]:
        with self._lock:
            if graph_id not in self._node_limiters:
                self._node_limiters[graph_id] = ConcurrencyLimiter(
                    max_concurrent=self.max_parallel_nodes_per_graph,
                )
            node_limiter = self._node_limiters[graph_id]
        graph_token = node_limiter.acquire(node_id, timeout=timeout)
        try:
            total_token = self._total_limiter.acquire(node_id, timeout=timeout)
        except LimitExceededError:
            node_limiter.release(graph_token)
            raise
        return graph_token, total_token

    def release_node(
        self,
        graph_id: str,
        graph_token: AcquisitionToken,
        total_token: AcquisitionToken,
    ) -> None:
        with self._lock:
            limiter = self._node_limiters.get(graph_id)
            if limiter is not None:
                limiter.release(graph_token)
        self._total_limiter.release(total_token)
