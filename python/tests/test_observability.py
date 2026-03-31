# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from unittest.mock import MagicMock

from graph_caster.observability.metrics import RunCounters
from graph_caster.observability.tracing import TracingLayer


def test_tracing_layer_creates_spans() -> None:
    tracer = MagicMock()
    layer = TracingLayer(tracer=tracer)

    layer.on_node_start("node-1", {"kind": "task"})
    layer.on_node_end("node-1", {"success": True, "duration_ms": 100})

    tracer.start_span.assert_called_once()
    span = tracer.start_span.return_value
    span.end.assert_called_once()


def test_run_counters_bump() -> None:
    c = RunCounters()
    c.nodes_entered += 1
    c.bump("x", 2)
    c.bump("x", 1)
    assert c.nodes_entered == 1
    assert c.extra["x"] == 3
