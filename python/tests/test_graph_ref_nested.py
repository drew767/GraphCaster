# Copyright Aura. All Rights Reserved.

from __future__ import annotations

import json
import sys
from pathlib import Path

from graph_caster.models import GraphDocument
from graph_caster.runner import GraphRunner
from graph_caster.workspace import clear_graph_index_cache


def _write(tmp: Path, name: str, doc: dict) -> Path:
    path = tmp / name
    path.write_text(json.dumps(doc), encoding="utf-8")
    return path


def _chain_graph(graph_id: str, start: str, mid: str, end: str, *, mid_type: str = "task", mid_data: dict | None = None) -> dict:
    data = mid_data if mid_data is not None else {"title": mid}
    return {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": graph_id, "title": graph_id[:8]},
        "viewport": {"x": 0, "y": 0, "zoom": 1},
        "nodes": [
            {"id": start, "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {"id": mid, "type": mid_type, "position": {"x": 0, "y": 0}, "data": data},
            {"id": end, "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
        ],
        "edges": [
            {
                "id": "k1",
                "source": start,
                "sourceHandle": "out_default",
                "target": mid,
                "targetHandle": "in_default",
                "condition": None,
            },
            {
                "id": "k2",
                "source": mid,
                "sourceHandle": "out_default",
                "target": end,
                "targetHandle": "in_default",
                "condition": None,
            },
        ],
    }


def test_nested_graph_ref_runs_child_then_parent_exit(tmp_path: Path) -> None:
    clear_graph_index_cache()
    child_id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
    parent_id = "ffffffff-ffff-4fff-8fff-ffffffffffff"
    _write(tmp_path, "child.json", _chain_graph(child_id, "cs", "ct", "ce"))
    parent = _chain_graph(parent_id, "ps", "pref", "pe", mid_type="graph_ref", mid_data={"targetGraphId": child_id})
    _write(tmp_path, "parent.json", parent)

    root_doc = GraphDocument.from_dict(parent)
    events: list[dict] = []
    GraphRunner(root_doc, sink=lambda e: events.append(e), graphs_root=tmp_path).run(
        context={"last_result": True}
    )
    types = [e["type"] for e in events]
    assert types.count("run_success") == 2
    assert events[-1]["type"] == "run_success"
    assert events[-1]["nodeId"] == "pe"
    assert events[-1]["graphId"] == parent_id
    assert "nested_graph_enter" in types
    assert "nested_graph_exit" in types
    assert events[types.index("nested_graph_enter")]["targetGraphId"] == child_id


def test_graph_ref_without_graphs_dir_errors(tmp_path: Path) -> None:
    clear_graph_index_cache()
    child_id = "11111111-1111-4111-8111-111111111111"
    parent_id = "22222222-2222-4222-8222-222222222222"
    _write(tmp_path, "child.json", _chain_graph(child_id, "cs", "ct", "ce"))
    parent = _chain_graph(parent_id, "ps", "pref", "pe", mid_type="graph_ref", mid_data={"targetGraphId": child_id})
    root_doc = GraphDocument.from_dict(parent)
    events: list[dict] = []
    GraphRunner(root_doc, sink=lambda e: events.append(e)).run(context={"last_result": True})
    assert any(e["type"] == "error" and e.get("message") == "graph_ref_requires_graphs_directory" for e in events)


def test_nested_task_failure_does_not_report_success_to_parent(tmp_path: Path) -> None:
    clear_graph_index_cache()
    child_id = "66666666-6666-4666-8666-666666666666"
    parent_id = "77777777-7777-4777-8777-777777777777"
    failing_child = _chain_graph(
        child_id,
        "cs",
        "ct",
        "ce",
        mid_type="task",
        mid_data={
            "command": [sys.executable, "-c", "raise SystemExit(7)"],
            "cwd": str(tmp_path),
            "retryCount": 0,
        },
    )
    _write(tmp_path, "child.json", failing_child)
    parent = _chain_graph(parent_id, "ps", "pref", "pe", mid_type="graph_ref", mid_data={"targetGraphId": child_id})
    _write(tmp_path, "parent.json", parent)
    root_doc = GraphDocument.from_dict(parent)
    events: list[dict] = []
    GraphRunner(root_doc, sink=lambda e: events.append(e), graphs_root=tmp_path).run(
        context={"last_result": True}
    )
    assert any(e["type"] == "nested_graph_exit" for e in events)
    assert any(
        e["type"] == "error" and e.get("message") == "nested_graph_run_incomplete" for e in events
    )
    assert not any(e["type"] == "run_success" for e in events)


def test_max_nesting_depth_blocks_deeper_ref(tmp_path: Path) -> None:
    clear_graph_index_cache()
    g0 = "33333333-3333-4333-8333-333333333333"
    g1 = "44444444-4444-4444-8444-444444444444"
    g2 = "55555555-5555-4555-8555-555555555555"
    _write(tmp_path, "leaf.json", _chain_graph(g2, "gs", "gt", "ge"))
    _write(
        tmp_path,
        "mid.json",
        _chain_graph(g1, "ms", "mref", "me", mid_type="graph_ref", mid_data={"targetGraphId": g2}),
    )
    root = _chain_graph(g0, "rs", "rref", "re", mid_type="graph_ref", mid_data={"targetGraphId": g1})
    _write(tmp_path, "root.json", root)
    doc = GraphDocument.from_dict(root)
    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e), graphs_root=tmp_path).run(
        context={"last_result": True, "max_nesting_depth": 1}
    )
    assert any(e["type"] == "error" and e.get("message") == "max_nesting_depth_exceeded" for e in events)
