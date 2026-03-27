# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
import sys
from pathlib import Path

from graph_caster.host_context import RunHostContext
from graph_caster.models import GraphDocument
from graph_caster.runner import GraphRunner

ROOT = Path(__file__).resolve().parents[2]


def test_branching_through_merge_reaches_exit(tmp_path: Path) -> None:
    raw = json.loads((ROOT / "schemas" / "test-fixtures" / "merge-after-branch.json").read_text(encoding="utf-8"))
    t1 = next(n for n in raw["nodes"] if n["id"] == "t1")
    t1["data"] = {
        "command": [sys.executable, "-c", "print('ok')"],
        "cwd": str(tmp_path),
    }
    doc = GraphDocument.from_dict(raw)
    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e), host=RunHostContext(artifacts_base=tmp_path)).run()
    assert events[-1]["type"] == "run_finished"
    assert events[-1].get("status") == "success"
    merge_executes = [e for e in events if e.get("type") == "node_execute" and e.get("nodeId") == "m1"]
    assert len(merge_executes) == 1
    outs = next(
        (e for e in events if e.get("type") == "node_exit" and e.get("nodeId") == "m1"),
        None,
    )
    assert outs is not None


def test_merge_passthrough_in_node_outputs(tmp_path: Path) -> None:
    gid = "11111111-1111-4111-8111-111111111111"
    doc = GraphDocument.from_dict(
        {
            "schemaVersion": 1,
            "meta": {"schemaVersion": 1, "graphId": gid, "title": "linear-merge"},
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "nodes": [
                {"id": "s1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {
                    "id": "t1",
                    "type": "task",
                    "position": {"x": 0, "y": 0},
                    "data": {
                        "command": [sys.executable, "-c", "print(1)"],
                        "cwd": str(tmp_path),
                    },
                },
                {"id": "m1", "type": "merge", "position": {"x": 0, "y": 0}, "data": {"title": "M"}},
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
                    "sourceHandle": "out_default",
                    "target": "m1",
                    "targetHandle": "in_default",
                    "condition": None,
                },
                {
                    "id": "e2",
                    "source": "m1",
                    "sourceHandle": "out_default",
                    "target": "x1",
                    "targetHandle": "in_default",
                    "condition": None,
                },
            ],
        }
    )
    ctx: dict = {}
    GraphRunner(doc, sink=lambda _e: None, host=RunHostContext(artifacts_base=tmp_path)).run(context=ctx)
    assert ctx.get("_run_success") is True
    no = ctx.get("node_outputs", {}).get("m1")
    assert no is not None
    assert no.get("merge") == {"passthrough": True}


def test_merge_few_inputs_emits_structure_warning(tmp_path: Path) -> None:
    gid = "11111111-1111-4111-8111-111111111112"
    doc = GraphDocument.from_dict(
        {
            "schemaVersion": 1,
            "meta": {"schemaVersion": 1, "graphId": gid, "title": "linear-merge"},
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "nodes": [
                {"id": "s1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {
                    "id": "t1",
                    "type": "task",
                    "position": {"x": 0, "y": 0},
                    "data": {
                        "command": [sys.executable, "-c", "print(1)"],
                        "cwd": str(tmp_path),
                    },
                },
                {"id": "m1", "type": "merge", "position": {"x": 0, "y": 0}, "data": {"title": "M"}},
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
                    "sourceHandle": "out_default",
                    "target": "m1",
                    "targetHandle": "in_default",
                    "condition": None,
                },
                {
                    "id": "e2",
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
    sw = [e for e in events if e.get("type") == "structure_warning"]
    assert len(sw) == 1
    assert sw[0].get("kind") == "merge_few_inputs"
    assert sw[0].get("nodeId") == "m1"
    assert sw[0].get("incomingEdges") == 1
    assert sw[0].get("graphId") == gid
