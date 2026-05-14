# Copyright GraphCaster. All Rights Reserved.

"""Arize Phoenix trace adapter.

Arize Phoenix accepts OTLP natively, so this adapter reuses the existing F13
OTel infrastructure — it just points the OTLP exporter to Phoenix's collector.

Requires: ``graph-caster[trace-phoenix]``  (graph-caster[otel] + httpx>=0.27)
Env vars:
    GC_TRACE_BACKEND=phoenix
    PHOENIX_COLLECTOR_ENDPOINT  — e.g. http://localhost:6006/v1/traces
        (sets OTEL_EXPORTER_OTLP_TRACES_ENDPOINT so existing otel_tracing picks it up)
"""

from __future__ import annotations

import logging
import os
from typing import ClassVar

from graph_caster.observability.adapters.base import TraceAdapter

_LOG = logging.getLogger(__name__)


class ArizePhoenixAdapter(TraceAdapter):
    """Thin adapter that wires Phoenix's OTLP endpoint into the existing OTel stack.

    The heavy lifting (span creation) is handled by ``otel_tracing.py`` (F13).
    This adapter's only real job is to ensure ``configure_otel()`` is called with
    the Phoenix endpoint when ``GC_TRACE_BACKEND=phoenix`` is set, and to provide
    the standard TraceAdapter lifecycle no-ops so the TraceAdapterSink can treat
    all adapters uniformly.
    """

    name: ClassVar[str] = "phoenix"

    def __init__(self, *, collector_endpoint: str | None = None) -> None:
        endpoint = collector_endpoint or os.environ.get("PHOENIX_COLLECTOR_ENDPOINT", "")
        if endpoint:
            os.environ.setdefault("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", endpoint)

    def on_run_started(self, run_id: str, graph_id: str, metadata: dict) -> None:
        pass

    def on_node_started(self, run_id: str, node_id: str, node_type: str, inputs: dict) -> None:
        pass

    def on_node_finished(
        self,
        run_id: str,
        node_id: str,
        outputs: dict,
        error: dict | None,
        usage: dict | None,
    ) -> None:
        pass

    def on_run_finished(self, run_id: str, status: str, summary: dict) -> None:
        pass

    async def flush(self) -> None:
        pass
