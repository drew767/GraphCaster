# Copyright GraphCaster. All Rights Reserved.

"""Factory: instantiate the correct adapter from ``GC_TRACE_BACKEND`` env var."""

from __future__ import annotations

import os

from graph_caster.observability.adapters.base import TraceAdapter


def get_adapter() -> TraceAdapter | None:
    """Return the active trace adapter, or ``None`` if ``GC_TRACE_BACKEND`` is unset/unknown."""
    backend = os.environ.get("GC_TRACE_BACKEND", "").strip().lower()
    if backend == "langfuse":
        from graph_caster.observability.adapters.langfuse import LangfuseAdapter
        return LangfuseAdapter()
    if backend == "langsmith":
        from graph_caster.observability.adapters.langsmith import LangSmithAdapter
        return LangSmithAdapter()
    if backend == "phoenix":
        from graph_caster.observability.adapters.phoenix import ArizePhoenixAdapter
        return ArizePhoenixAdapter()
    return None
