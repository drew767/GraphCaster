# Copyright Aura. All Rights Reserved.

from __future__ import annotations

import pytest

from graph_caster.gc_pin import snapshot_for_pin_event
from graph_caster.redaction.run_event_redaction import (
    redact_snapshot_payload,
    snapshot_redaction_enabled,
)
from graph_caster.runner import GraphRunner
from graph_caster.models import Edge, GraphDocument, Node


def test_snapshot_redaction_enabled_from_context() -> None:
    assert snapshot_redaction_enabled({"redact_node_outputs_snapshot": True}) is True
    assert snapshot_redaction_enabled({}) is False


def test_snapshot_redaction_enabled_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_RUN_SNAPSHOT_REDACT", "1")
    assert snapshot_redaction_enabled({}) is True


def test_redact_snapshot_strips_sensitive_keys_in_process_result() -> None:
    raw = {
        "nodeType": "task",
        "processResult": {
            "stdout": "ok",
            "headers": {"authorization": "Bearer secret", "x-ok": "1"},
            "api_key": "k",
        },
    }
    snap = snapshot_for_pin_event(raw)
    out = redact_snapshot_payload(snap)
    pr = out["processResult"]
    assert pr["headers"]["authorization"] == "[redacted]"
    assert pr["headers"]["x-ok"] == "1"
    assert pr["api_key"] == "[redacted]"


def test_runner_emit_snapshot_respects_redact_flag() -> None:
    nodes = [
        Node("s", "start", {"x": 0, "y": 0}, {}),
        Node("t", "task", {"x": 1, "y": 0}, {"command": "echo", "args": ["hi"]}),
        Node("x", "exit", {"x": 2, "y": 0}, {}),
    ]
    edges = [
        Edge("e0", "s", "out_default", "t", "in_default", None, None),
        Edge("e1", "t", "out_default", "x", "in_default", None, None),
    ]
    doc = GraphDocument(1, "g1", nodes, edges)
    events: list[dict] = []

    def sink(e: dict) -> None:
        events.append(e)

    r = GraphRunner(doc, sink=sink)
    outs = {
        "t": {
            "nodeType": "task",
            "processResult": {
                "password": "x",
                "stdout": "yo",
            },
        }
    }
    r.emit_node_outputs_snapshot({"redact_node_outputs_snapshot": True}, "t", outs["t"])
    snap_ev = next(e for e in events if e["type"] == "node_outputs_snapshot")
    assert snap_ev["snapshot"]["processResult"]["password"] == "[redacted]"
