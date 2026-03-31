# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from graph_caster.execution.execution_coordinator import ExecutionCoordinator
from graph_caster.execution.pool_sizing import resolve_fork_parallel_threadpool_workers


def test_execution_coordinator_matches_pool_sizing() -> None:
    c = ExecutionCoordinator()
    assert c.fork_threadpool_workers(5, 3) == resolve_fork_parallel_threadpool_workers(5, 3)
