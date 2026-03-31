# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import os

from graph_caster.execution.pool_sizing import resolve_fork_parallel_threadpool_workers


def test_pool_sizing_min_of_cap_and_plans() -> None:
    assert resolve_fork_parallel_threadpool_workers(10, 3) == 3
    assert resolve_fork_parallel_threadpool_workers(2, 8) == 2


def test_pool_sizing_respects_gc_graph_fork_threadpool_max(monkeypatch) -> None:
    monkeypatch.setenv("GC_GRAPH_FORK_THREADPOOL_MAX", "2")
    assert resolve_fork_parallel_threadpool_workers(10, 8) == 2
    monkeypatch.delenv("GC_GRAPH_FORK_THREADPOOL_MAX", raising=False)


def test_pool_sizing_at_least_one() -> None:
    assert resolve_fork_parallel_threadpool_workers(0, 4) == 1
