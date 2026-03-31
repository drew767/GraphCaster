# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from graph_caster.execution.pool_sizing import (
    fork_threadpool_env_ceiling_for_metrics,
    fork_threadpool_env_min_for_metrics,
    resolve_fork_parallel_threadpool_workers,
)


def test_pool_sizing_min_of_cap_and_plans() -> None:
    assert resolve_fork_parallel_threadpool_workers(10, 3) == 3
    assert resolve_fork_parallel_threadpool_workers(2, 8) == 2


def test_pool_sizing_respects_gc_graph_fork_threadpool_max(monkeypatch) -> None:
    monkeypatch.setenv("GC_GRAPH_FORK_THREADPOOL_MAX", "2")
    assert resolve_fork_parallel_threadpool_workers(10, 8) == 2
    monkeypatch.delenv("GC_GRAPH_FORK_THREADPOOL_MAX", raising=False)


def test_pool_sizing_falls_back_to_gc_runner_max_workers(monkeypatch) -> None:
    monkeypatch.delenv("GC_GRAPH_FORK_THREADPOOL_MAX", raising=False)
    monkeypatch.setenv("GC_RUNNER_MAX_WORKERS", "3")
    assert resolve_fork_parallel_threadpool_workers(10, 8) == 3
    monkeypatch.delenv("GC_RUNNER_MAX_WORKERS", raising=False)


def test_pool_sizing_graph_env_wins_over_runner_alias(monkeypatch) -> None:
    monkeypatch.setenv("GC_GRAPH_FORK_THREADPOOL_MAX", "2")
    monkeypatch.setenv("GC_RUNNER_MAX_WORKERS", "9")
    assert resolve_fork_parallel_threadpool_workers(10, 8) == 2


def test_fork_metrics_ceiling_uses_runner_alias(monkeypatch) -> None:
    monkeypatch.delenv("GC_GRAPH_FORK_THREADPOOL_MAX", raising=False)
    monkeypatch.setenv("GC_RUNNER_MAX_WORKERS", "5")
    assert fork_threadpool_env_ceiling_for_metrics() == 5
    monkeypatch.delenv("GC_RUNNER_MAX_WORKERS", raising=False)


def test_pool_sizing_at_least_one() -> None:
    assert resolve_fork_parallel_threadpool_workers(0, 4) == 1


def test_pool_sizing_gc_runner_min_workers_floor(monkeypatch) -> None:
    monkeypatch.delenv("GC_GRAPH_FORK_THREADPOOL_MAX", raising=False)
    monkeypatch.delenv("GC_RUNNER_MAX_WORKERS", raising=False)
    monkeypatch.setenv("GC_RUNNER_MIN_WORKERS", "4")
    try:
        assert resolve_fork_parallel_threadpool_workers(1, 8) == 4
    finally:
        monkeypatch.delenv("GC_RUNNER_MIN_WORKERS", raising=False)


def test_pool_sizing_min_respects_ceiling(monkeypatch) -> None:
    monkeypatch.setenv("GC_GRAPH_FORK_THREADPOOL_MAX", "2")
    monkeypatch.setenv("GC_RUNNER_MIN_WORKERS", "8")
    try:
        assert resolve_fork_parallel_threadpool_workers(10, 16) == 2
    finally:
        monkeypatch.delenv("GC_GRAPH_FORK_THREADPOOL_MAX", raising=False)
        monkeypatch.delenv("GC_RUNNER_MIN_WORKERS", raising=False)


def test_fork_metrics_min(monkeypatch) -> None:
    monkeypatch.setenv("GC_RUNNER_MIN_WORKERS", "3")
    try:
        assert fork_threadpool_env_min_for_metrics() == 3
    finally:
        monkeypatch.delenv("GC_RUNNER_MIN_WORKERS", raising=False)
