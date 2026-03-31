# Copyright Aura. All Rights Reserved.

from __future__ import annotations

import os


def is_graph_builtin_scheduler_enabled() -> bool:
    """Return True when in-process :class:`GraphCronScheduler` is allowed to start.

    Off by default. Set ``GC_GRAPH_BUILTIN_SCHEDULER`` to ``1``, ``true``, ``yes``, or ``on``
    to opt in (dev / embedded hosts). Production graphs are normally triggered by an external
    scheduler or the run broker, not this loop.
    """
    v = (os.environ.get("GC_GRAPH_BUILTIN_SCHEDULER") or "").strip().lower()
    return v in ("1", "true", "yes", "on")
