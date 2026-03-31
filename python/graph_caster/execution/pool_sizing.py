# Copyright GraphCaster. All Rights Reserved.

"""Fork parallel branch thread-pool sizing (caps + optional env ceiling)."""

from __future__ import annotations

import os


def _fork_threadpool_max_raw() -> str:
    """Env chain for fork frontier ceiling: **GC_GRAPH_FORK_THREADPOOL_MAX**, else **GC_RUNNER_MAX_WORKERS**."""

    primary = os.environ.get("GC_GRAPH_FORK_THREADPOOL_MAX", "").strip()
    if primary:
        return primary
    return os.environ.get("GC_RUNNER_MAX_WORKERS", "").strip()


def fork_threadpool_env_ceiling_for_metrics() -> int:
    """Return configured ceiling as a positive int, or **0** if unset/invalid.

    Reads **GC_GRAPH_FORK_THREADPOOL_MAX** first; if empty, falls back to **GC_RUNNER_MAX_WORKERS**
    (fleet-wide alias for the same fork threadpool cap).
    """

    raw = _fork_threadpool_max_raw()
    if raw.isdigit():
        return max(1, int(raw))
    return 0


def _fork_threadpool_min_raw() -> str:
    return os.environ.get("GC_RUNNER_MIN_WORKERS", "").strip()


def fork_threadpool_env_min_for_metrics() -> int:
    """Return **GC_RUNNER_MIN_WORKERS** as a positive int, or **0** if unset/invalid."""

    raw = _fork_threadpool_min_raw()
    if raw.isdigit():
        return max(1, int(raw))
    return 0


def resolve_fork_parallel_threadpool_workers(n_plans: int, cap: int) -> int:
    """Return worker count for :class:`~concurrent.futures.ThreadPoolExecutor` on a fork frontier.

    ``cap`` is already resolved from node data + ``fork_max_parallel`` policy.
    When **GC_GRAPH_FORK_THREADPOOL_MAX** or **GC_RUNNER_MAX_WORKERS** (fallback) is a positive
    integer, it acts as a hard ceiling (fleet / OS limit) independent of any single fork node.

    When **GC_RUNNER_MIN_WORKERS** is a positive integer, the pool size is at least
    ``min(floor, cap)`` (cannot exceed the resolved per-fork cap ``c``).
    """
    c = max(1, int(cap))
    raw = _fork_threadpool_max_raw()
    if raw.isdigit():
        c = min(c, max(1, int(raw)))
    n = max(1, int(n_plans))
    w = max(1, min(c, n))
    min_raw = _fork_threadpool_min_raw()
    if min_raw.isdigit():
        floor = max(1, int(min_raw))
        w = max(w, min(floor, c))
    return w
