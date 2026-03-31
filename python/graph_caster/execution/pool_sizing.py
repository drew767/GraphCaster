# Copyright GraphCaster. All Rights Reserved.

"""Fork parallel branch thread-pool sizing (caps + optional env ceiling)."""

from __future__ import annotations

import os


def fork_threadpool_env_ceiling_for_metrics() -> int:
    """Return **GC_GRAPH_FORK_THREADPOOL_MAX** as a positive int, or **0** if unset/invalid."""

    raw = os.environ.get("GC_GRAPH_FORK_THREADPOOL_MAX", "").strip()
    if raw.isdigit():
        return max(1, int(raw))
    return 0


def resolve_fork_parallel_threadpool_workers(n_plans: int, cap: int) -> int:
    """Return worker count for :class:`~concurrent.futures.ThreadPoolExecutor` on a fork frontier.

    ``cap`` is already resolved from node data + ``fork_max_parallel`` policy.
    When ``GC_GRAPH_FORK_THREADPOOL_MAX`` is set to a positive integer, it acts as
    a hard ceiling (fleet / OS limit) independent of any single fork node.
    """
    c = max(1, int(cap))
    raw = os.environ.get("GC_GRAPH_FORK_THREADPOOL_MAX", "").strip()
    if raw.isdigit():
        c = min(c, max(1, int(raw)))
    n = max(1, int(n_plans))
    return max(1, min(c, n))
