# Copyright GraphCaster. All Rights Reserved.

"""Tracer-agnostic span helper for graph/node lifecycle."""

from __future__ import annotations

from typing import Any, Protocol


class TracerProtocol(Protocol):
    def start_span(self, name: str, attributes: dict[str, Any] | None = None) -> Any: ...


class TracingLayer:
    """Optional callbacks for OpenTelemetry or other tracers."""

    def __init__(self, tracer: TracerProtocol | None = None) -> None:
        self._tracer = tracer
        self._spans: dict[str, Any] = {}
        self._root_span: Any | None = None

    def on_node_start(self, node_id: str, node_data: dict[str, Any]) -> None:
        if not self._tracer:
            return
        span = self._tracer.start_span(
            f"node.{node_data.get('kind', 'unknown')}",
            attributes={
                "node.id": node_id,
                "node.kind": node_data.get("kind"),
            },
        )
        self._spans[node_id] = span

    def on_node_end(self, node_id: str, result: dict[str, Any]) -> None:
        span = self._spans.pop(node_id, None)
        if span:
            span.set_attribute("node.success", result.get("success", False))
            span.set_attribute("node.duration_ms", result.get("duration_ms", 0))
            span.end()

    def on_graph_start(self, run_id: str) -> None:
        if self._tracer:
            self._root_span = self._tracer.start_span(
                "graph.run",
                attributes={"run.id": run_id},
            )

    def on_graph_end(self, run_id: str, success: bool) -> None:
        if self._root_span is not None:
            self._root_span.set_attribute("run.success", success)
            self._root_span.end()
            self._root_span = None
