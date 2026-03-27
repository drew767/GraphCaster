# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
from pathlib import Path

from graph_caster.host_context import RunHostContext
from graph_caster.models import GraphDocument
from graph_caster.runner import GraphRunner

_ROOT = Path(__file__).resolve().parents[2]
_FIXTURE = _ROOT / "schemas" / "test-fixtures" / "partial-run-linear.json"


def test_stop_after_node_emits_partial_and_skips_exit() -> None:
    raw = json.loads(_FIXTURE.read_text(encoding="utf-8"))
    doc = GraphDocument.from_dict(raw)
    events: list[dict] = []
    GraphRunner(
        doc,
        sink=lambda e: events.append(e),
        host=RunHostContext(),
        stop_after_node_id="tb_mid",
    ).run(context={"last_result": True})
    types = [e["type"] for e in events]
    assert "node_exit" in types
    assert types.count("node_enter") == 2
    assert not any(e["type"] == "node_enter" and e.get("nodeId") == "x0" for e in events)
    finished = [e for e in events if e["type"] == "run_finished"]
    assert len(finished) == 1
    assert finished[-1]["status"] == "partial"


def test_full_run_to_exit_still_success() -> None:
    raw = json.loads(_FIXTURE.read_text(encoding="utf-8"))
    doc = GraphDocument.from_dict(raw)
    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e), host=RunHostContext()).run(context={"last_result": True})
    finished = [e for e in events if e["type"] == "run_finished"]
    assert finished[-1]["status"] == "success"


def test_run_from_with_context_json_merge_sees_node_outputs() -> None:
    raw = json.loads(_FIXTURE.read_text(encoding="utf-8"))
    doc = GraphDocument.from_dict(raw)
    from graph_caster.edge_conditions import eval_edge_condition

    ctx = {
        "last_result": True,
        "node_outputs": {"upstream": {"nodeType": "task", "data": {"x": 1}}},
    }
    assert eval_edge_condition("{{ node_outputs.upstream.data.x }} == 1", ctx) is True


def test_stop_after_exit_node_is_success_not_partial() -> None:
    raw = json.loads(_FIXTURE.read_text(encoding="utf-8"))
    doc = GraphDocument.from_dict(raw)
    events: list[dict] = []
    GraphRunner(
        doc,
        sink=lambda e: events.append(e),
        host=RunHostContext(),
        stop_after_node_id="x0",
    ).run(context={"last_result": True})
    finished = [e for e in events if e["type"] == "run_finished"]
    assert finished[-1]["status"] == "success"
    assert any(e["type"] == "run_success" for e in events)
