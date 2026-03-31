# Copyright GraphCaster. All Rights Reserved.

"""Fork-frontier sizing and orchestration hook (roadmap **ExecutionCoordinator**).

Full Dify-style global ready-queue + worker pool integration is incremental; this
class centralizes fork :class:`~concurrent.futures.ThreadPoolExecutor` sizing so
runners and tests can depend on one entry point.
"""

from __future__ import annotations

from graph_caster.execution.pool_sizing import resolve_fork_parallel_threadpool_workers


class ExecutionCoordinator:
    """Resolves fork-parallel thread pool worker counts (env-aware)."""

    def fork_threadpool_workers(self, n_plans: int, branch_parallel_cap: int) -> int:
        return resolve_fork_parallel_threadpool_workers(n_plans, branch_parallel_cap)


__all__ = ["ExecutionCoordinator"]
