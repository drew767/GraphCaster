# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
import sys
from pathlib import Path

from graph_caster import GraphRunner, validate_graph_structure
from graph_caster.host_context import RunHostContext
from graph_caster.models import GraphDocument, Node
from graph_caster.validate import (
    find_barrier_merge_no_success_incoming_warnings,
    find_barrier_merge_out_error_incoming,
    find_fork_few_outputs_warnings,
    merge_mode,
)

ROOT = Path(__file__).resolve().parents[2]


def _cmd_py() -> list[str]:
    return [sys.executable, "-c", "print(1)"]


def test_barrier_runs_after_two_branches(tmp_path: Path) -> None:
    raw = json.loads((ROOT / "schemas" / "test-fixtures" / "fork-merge-barrier.json").read_text(encoding="utf-8"))
    for nid in ("t0", "ta", "tb"):
        n = next(x for x in raw["nodes"] if x["id"] == nid)
        n["data"] = {"command": _cmd_py(), "cwd": str(tmp_path)}
    doc = GraphDocument.from_dict(raw)
    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e), host=RunHostContext(artifacts_base=tmp_path)).run()
    assert events[-1]["type"] == "run_finished"
    assert events[-1].get("status") == "success"
    merge_exec = [e for e in events if e.get("type") == "node_execute" and e.get("nodeId") == "m1"]
    assert len(merge_exec) == 1
    ta_exit_idx = next(i for i, e in enumerate(events) if e.get("type") == "node_exit" and e.get("nodeId") == "ta")
    tb_exit_idx = next(i for i, e in enumerate(events) if e.get("type") == "node_exit" and e.get("nodeId") == "tb")
    merge_enter_idx = next(i for i, e in enumerate(events) if e.get("type") == "node_enter" and e.get("nodeId") == "m1")
    assert ta_exit_idx < merge_enter_idx and tb_exit_idx < merge_enter_idx


def test_merge_barrier_incomplete_when_branch_never_runs(tmp_path: Path) -> None:
    gid = "99999999-9999-4999-8999-999999999999"
    doc = GraphDocument.from_dict(
        {
            "schemaVersion": 1,
            "meta": {"schemaVersion": 1, "graphId": gid, "title": "t"},
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "nodes": [
                {"id": "s1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {
                    "id": "t0",
                    "type": "task",
                    "position": {"x": 0, "y": 0},
                    "data": {"command": _cmd_py(), "cwd": str(tmp_path)},
                },
                {
                    "id": "tl",
                    "type": "task",
                    "position": {"x": 0, "y": 0},
                    "data": {"command": _cmd_py(), "cwd": str(tmp_path)},
                },
                {
                    "id": "tr",
                    "type": "task",
                    "position": {"x": 0, "y": 0},
                    "data": {"command": _cmd_py(), "cwd": str(tmp_path)},
                },
                {
                    "id": "m1",
                    "type": "merge",
                    "position": {"x": 0, "y": 0},
                    "data": {"mode": "barrier"},
                },
                {"id": "x1", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
            ],
            "edges": [
                {
                    "id": "e0",
                    "source": "s1",
                    "sourceHandle": "out_default",
                    "target": "t0",
                    "targetHandle": "in_default",
                    "condition": None,
                },
                {
                    "id": "el",
                    "source": "t0",
                    "sourceHandle": "out_default",
                    "target": "tl",
                    "targetHandle": "in_default",
                    "condition": None,
                },
                {
                    "id": "er",
                    "source": "t0",
                    "sourceHandle": "out_default",
                    "target": "tr",
                    "targetHandle": "in_default",
                    "condition": "false",
                },
                {
                    "id": "e_ml",
                    "source": "tl",
                    "sourceHandle": "out_default",
                    "target": "m1",
                    "targetHandle": "in_default",
                    "condition": None,
                },
                {
                    "id": "e_mr",
                    "source": "tr",
                    "sourceHandle": "out_default",
                    "target": "m1",
                    "targetHandle": "in_default",
                    "condition": None,
                },
                {
                    "id": "ex",
                    "source": "m1",
                    "sourceHandle": "out_default",
                    "target": "x1",
                    "targetHandle": "in_default",
                    "condition": None,
                },
            ],
        }
    )
    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e), host=RunHostContext(artifacts_base=tmp_path)).run()
    assert any(e.get("type") == "error" and e.get("message") == "merge_barrier_incomplete" for e in events)
    assert events[-1].get("status") == "failed"


def test_partial_stop_before_barrier_no_merge(tmp_path: Path) -> None:
    raw = json.loads((ROOT / "schemas" / "test-fixtures" / "fork-merge-barrier.json").read_text(encoding="utf-8"))
    for nid in ("t0", "ta", "tb"):
        n = next(x for x in raw["nodes"] if x["id"] == nid)
        n["data"] = {"command": _cmd_py(), "cwd": str(tmp_path)}
    doc = GraphDocument.from_dict(raw)
    events: list[dict] = []
    GraphRunner(
        doc,
        sink=lambda e: events.append(e),
        host=RunHostContext(artifacts_base=tmp_path),
        stop_after_node_id="ta",
    ).run()
    assert events[-1].get("status") == "partial"
    assert not any(e.get("type") == "node_execute" and e.get("nodeId") == "m1" for e in events)
    assert not any(e.get("type") == "error" and e.get("message") == "merge_barrier_incomplete" for e in events)


def test_fork_fixture_validates() -> None:
    doc = GraphDocument.from_dict(
        json.loads((ROOT / "schemas" / "test-fixtures" / "fork-merge-barrier.json").read_text(encoding="utf-8"))
    )
    assert validate_graph_structure(doc) == "s1"


def test_merge_mode_helper() -> None:
    n = Node(id="m", type="merge", position={}, data={"mode": "barrier"})
    assert merge_mode(n) == "barrier"
    n2 = Node(id="m2", type="merge", position={}, data={})
    assert merge_mode(n2) == "passthrough"


def test_find_fork_few_outputs() -> None:
    gid = "88888888-8888-4888-8888-888888888888"
    doc = GraphDocument.from_dict(
        {
            "schemaVersion": 1,
            "meta": {"schemaVersion": 1, "graphId": gid, "title": "t"},
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "nodes": [
                {"id": "s1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {"id": "f1", "type": "fork", "position": {"x": 0, "y": 0}, "data": {}},
                {"id": "t1", "type": "task", "position": {"x": 0, "y": 0}, "data": {}},
                {"id": "x1", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
            ],
            "edges": [
                {
                    "id": "e0",
                    "source": "s1",
                    "sourceHandle": "out_default",
                    "target": "f1",
                    "targetHandle": "in_default",
                    "condition": None,
                },
                {
                    "id": "e1",
                    "source": "f1",
                    "sourceHandle": "out_default",
                    "target": "t1",
                    "targetHandle": "in_default",
                    "condition": None,
                },
                {
                    "id": "e2",
                    "source": "t1",
                    "sourceHandle": "out_default",
                    "target": "x1",
                    "targetHandle": "in_default",
                    "condition": None,
                },
            ],
        }
    )
    w = find_fork_few_outputs_warnings(doc)
    assert len(w) == 1 and w[0]["nodeId"] == "f1"


def test_error_route_to_barrier_merge_blocked_emits_error(tmp_path: Path) -> None:
    gid = "66666666-6666-4666-8666-666666666666"
    doc = GraphDocument.from_dict(
        {
            "schemaVersion": 1,
            "meta": {"schemaVersion": 1, "graphId": gid, "title": "t"},
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "nodes": [
                {"id": "s1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {
                    "id": "bad",
                    "type": "task",
                    "position": {"x": 0, "y": 0},
                    "data": {
                        "command": [sys.executable, "-c", "raise SystemExit(1)"],
                        "cwd": str(tmp_path),
                        "retryCount": 0,
                    },
                },
                {"id": "m1", "type": "merge", "position": {"x": 0, "y": 0}, "data": {"mode": "barrier"}},
                {"id": "x1", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
            ],
            "edges": [
                {
                    "id": "e0",
                    "source": "s1",
                    "sourceHandle": "out_default",
                    "target": "bad",
                    "targetHandle": "in_default",
                    "condition": None,
                },
                {
                    "id": "e_err",
                    "source": "bad",
                    "sourceHandle": "out_error",
                    "target": "m1",
                    "targetHandle": "in_default",
                    "condition": None,
                },
                {
                    "id": "ex",
                    "source": "m1",
                    "sourceHandle": "out_default",
                    "target": "x1",
                    "targetHandle": "in_default",
                    "condition": None,
                },
            ],
        }
    )
    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e), host=RunHostContext(artifacts_base=tmp_path)).run()
    assert any(
        e.get("type") == "error" and e.get("message") == "barrier_merge_error_path_not_supported" for e in events
    )
    assert events[-1].get("status") == "failed"


def test_barrier_merge_no_success_incoming_warning_found() -> None:
    gid = "55555555-5555-4555-8555-555555555555"
    doc = GraphDocument.from_dict(
        {
            "schemaVersion": 1,
            "meta": {"schemaVersion": 1, "graphId": gid, "title": "t"},
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "nodes": [
                {"id": "s1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {
                    "id": "t1",
                    "type": "task",
                    "position": {"x": 0, "y": 0},
                    "data": {},
                },
                {
                    "id": "t2",
                    "type": "task",
                    "position": {"x": 0, "y": 0},
                    "data": {},
                },
                {"id": "m1", "type": "merge", "position": {"x": 0, "y": 0}, "data": {"mode": "barrier"}},
                {"id": "x1", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
            ],
            "edges": [
                {
                    "id": "e0",
                    "source": "s1",
                    "sourceHandle": "out_default",
                    "target": "t1",
                    "targetHandle": "in_default",
                    "condition": None,
                },
                {
                    "id": "e1",
                    "source": "t1",
                    "sourceHandle": "out_error",
                    "target": "m1",
                    "targetHandle": "in_default",
                    "condition": None,
                },
                {
                    "id": "e2",
                    "source": "t2",
                    "sourceHandle": "out_error",
                    "target": "m1",
                    "targetHandle": "in_default",
                    "condition": None,
                },
                {
                    "id": "e_s2",
                    "source": "s1",
                    "sourceHandle": "out_default",
                    "target": "t2",
                    "targetHandle": "in_default",
                    "condition": None,
                },
            ],
        }
    )
    w = find_barrier_merge_no_success_incoming_warnings(doc)
    assert len(w) == 1 and w[0]["nodeId"] == "m1"


def test_barrier_out_error_incoming_warns() -> None:
    gid = "77777777-7777-4777-8777-777777777777"
    doc = GraphDocument.from_dict(
        {
            "schemaVersion": 1,
            "meta": {"schemaVersion": 1, "graphId": gid, "title": "t"},
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "nodes": [
                {"id": "s1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {
                    "id": "t1",
                    "type": "task",
                    "position": {"x": 0, "y": 0},
                    "data": {"command": "x"},
                },
                {"id": "m1", "type": "merge", "position": {"x": 0, "y": 0}, "data": {"mode": "barrier"}},
                {"id": "x1", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
            ],
            "edges": [
                {
                    "id": "e0",
                    "source": "s1",
                    "sourceHandle": "out_default",
                    "target": "t1",
                    "targetHandle": "in_default",
                    "condition": None,
                },
                {
                    "id": "ee",
                    "source": "t1",
                    "sourceHandle": "out_error",
                    "target": "m1",
                    "targetHandle": "in_default",
                    "condition": None,
                },
                {
                    "id": "ex",
                    "source": "t1",
                    "sourceHandle": "out_default",
                    "target": "x1",
                    "targetHandle": "in_default",
                    "condition": None,
                },
            ],
        }
    )
    r = find_barrier_merge_out_error_incoming(doc)
    assert len(r) == 1 and r[0]["edgeId"] == "ee"