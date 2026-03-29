# Copyright GraphCaster. All Rights Reserved.

"""OpenTelemetry integration tests (skip unless ``pip install -e ".[otel]"``)."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from textwrap import dedent
from typing import Any

_PYTHON_ROOT = Path(__file__).resolve().parents[1]

import pytest

pytest.importorskip("opentelemetry.sdk.trace.export", reason="install graph-caster[otel]")

from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from graph_caster import otel_tracing
from graph_caster.models import Edge, GraphDocument, Node
from graph_caster.runner import GraphRunner

_configure_ran = False
_memory_exporter: InMemorySpanExporter | None = None


def _ensure_memory_exporter() -> InMemorySpanExporter:
    global _configure_ran, _memory_exporter
    if not _configure_ran:
        _memory_exporter = InMemorySpanExporter()
        otel_tracing.configure_otel(test_span_exporter=_memory_exporter)
        _configure_ran = True
    assert _memory_exporter is not None
    return _memory_exporter


def _minimal_start_exit_doc() -> GraphDocument:
    return GraphDocument(
        schema_version=1,
        graph_id="otel-test-g1",
        title=None,
        author=None,
        viewport={"x": 0, "y": 0, "zoom": 1},
        nodes=[
            Node(id="s1", type="start", position={"x": 0, "y": 0}, data={}),
            Node(id="x1", type="exit", position={"x": 1, "y": 1}, data={}),
        ],
        edges=[
            Edge(
                id="e1",
                source="s1",
                target="x1",
                source_handle="out_default",
                target_handle="in_default",
                condition=None,
            )
        ],
    )


def test_in_memory_exporter_and_gc_run_gc_node_spans() -> None:
    exporter = _ensure_memory_exporter()
    exporter.clear()

    tracer = otel_tracing.get_tracer()
    with tracer.start_as_current_span("unit.test"):
        pass
    unit_spans = exporter.get_finished_spans()
    assert len(unit_spans) == 1
    assert unit_spans[0].name == "unit.test"

    doc = _minimal_start_exit_doc()
    events: list[dict[str, Any]] = []
    runner = GraphRunner(doc, sink=lambda e: events.append(e))
    runner.run(context={"last_result": True, "run_id": "rid-otel-1"})

    spans = exporter.get_finished_spans()
    names = [s.name for s in spans]
    assert "gc.run" in names
    assert names.count("gc.node") >= 2

    root = next(s for s in spans if s.name == "gc.run")
    rid = next(
        (v for k, v in root.attributes.items() if k == "graph_caster.run_id"),
        None,
    )
    assert rid in ("rid-otel-1", runner._run_id)

    node_spans = [s for s in spans if s.name == "gc.node"]
    for s in node_spans:
        attrs = dict(s.attributes)
        assert attrs.get("graph_caster.graph_id") == "otel-test-g1"
        assert attrs.get("graph_caster.node_id") in ("s1", "x1")


def test_is_otel_configured_false_without_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in (
        "GC_OTEL_EXPORTER_OTLP_ENDPOINT",
        "OTEL_EXPORTER_OTLP_ENDPOINT",
        "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
    ):
        monkeypatch.delenv(key, raising=False)
    assert otel_tracing.is_otel_configured() is False


def test_configure_otlp_from_env_in_subprocess() -> None:
    code = dedent(
        """
        import os
        os.environ["GC_OTEL_EXPORTER_OTLP_ENDPOINT"] = "http://127.0.0.1:4318"
        from graph_caster.otel_tracing import configure_otel
        configure_otel()
        from opentelemetry import trace
        with trace.get_tracer("smoke").start_as_current_span("s"):
            pass
        print("ok")
        """
    )
    proc = subprocess.run(
        [sys.executable, "-c", code],
        cwd=str(_PYTHON_ROOT),
        check=False,
        capture_output=True,
        text=True,
    )
    assert proc.returncode == 0, proc.stderr
