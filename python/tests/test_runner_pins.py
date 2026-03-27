# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
import sys
from pathlib import Path

from graph_caster.gc_pin import find_gc_pin_empty_payload_warnings
from graph_caster.models import GraphDocument
from graph_caster.runner import GraphRunner

GRAPH_CASTER_ROOT = Path(__file__).resolve().parents[2]


def _doc_pin_shortcircuit(tmp: Path) -> GraphDocument:
    gid = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    return GraphDocument.from_dict(
        {
            "schemaVersion": 1,
            "meta": {"schemaVersion": 1, "graphId": gid, "title": "pin-skip"},
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "nodes": [
                {"id": "s1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {
                    "id": "t1",
                    "type": "task",
                    "position": {"x": 0, "y": 0},
                    "data": {
                        "command": [sys.executable, "-c", "raise SystemExit(99)"],
                        "cwd": str(tmp),
                        "gcPin": {
                            "enabled": True,
                            "payload": {
                                "processResult": {
                                    "success": True,
                                    "exitCode": 0,
                                    "stdoutTail": "",
                                    "stderrTail": "",
                                }
                            },
                        },
                    },
                },
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
                    "target": "x1",
                    "targetHandle": "in_default",
                    "condition": None,
                },
            ],
        }
    )


def test_gc_pin_short_circuit_skips_process_and_succeeds(tmp_path: Path) -> None:
    doc = _doc_pin_shortcircuit(tmp_path)
    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e)).run(context={"last_result": True})
    types = [e.get("type") for e in events]
    assert "node_pinned_skip" in types
    assert "run_success" in types
    assert "process_spawn" not in types


def test_gc_pin_no_short_circuit_when_context_has_empty_node_output(tmp_path: Path) -> None:
    doc = _doc_pin_shortcircuit(tmp_path)
    events: list[dict] = []
    GraphRunner(
        doc,
        sink=lambda e: events.append(e),
    ).run(context={"last_result": True, "node_outputs": {"t1": {}}})
    types = [e.get("type") for e in events]
    assert "node_pinned_skip" not in types
    assert "process_spawn" in types


def test_gc_pin_no_short_circuit_when_context_missing_process_result(tmp_path: Path) -> None:
    doc = _doc_pin_shortcircuit(tmp_path)
    events: list[dict] = []
    GraphRunner(
        doc,
        sink=lambda e: events.append(e),
    ).run(
        context={
            "last_result": True,
            "node_outputs": {"t1": {"nodeType": "task", "data": {}}},
        }
    )
    types = [e.get("type") for e in events]
    assert "node_pinned_skip" not in types
    assert "process_spawn" in types


def test_context_node_outputs_wins_over_gc_pin_seed(tmp_path: Path) -> None:
    doc = _doc_pin_shortcircuit(tmp_path)
    events: list[dict] = []
    ctx = {
        "last_result": True,
        "node_outputs": {
            "t1": {
                "processResult": {
                    "success": False,
                    "exitCode": 1,
                    "stdoutTail": "",
                    "stderrTail": "",
                }
            }
        },
    }
    GraphRunner(doc, sink=lambda e: events.append(e)).run(context=ctx)
    types = [e.get("type") for e in events]
    assert "node_pinned_skip" in types
    assert "process_spawn" not in types
    assert "run_success" not in types


def test_gc_pin_empty_payload_structure_warning(tmp_path: Path) -> None:
    gid = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
    doc = GraphDocument.from_dict(
        {
            "schemaVersion": 1,
            "meta": {"schemaVersion": 1, "graphId": gid, "title": "pin-empty"},
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
                        "gcPin": {"enabled": True, "payload": {}},
                    },
                },
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
                    "target": "x1",
                    "targetHandle": "in_default",
                    "condition": None,
                },
            ],
        }
    )
    w = find_gc_pin_empty_payload_warnings(doc)
    assert len(w) == 1 and w[0]["nodeId"] == "t1"
    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e)).run(context={"last_result": True})
    warns = [e for e in events if e.get("type") == "structure_warning"]
    assert any(
        e.get("kind") == "gc_pin_enabled_empty_payload" and e.get("nodeId") == "t1" for e in warns
    )


def test_node_outputs_snapshot_after_real_task(tmp_path: Path) -> None:
    gid = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
    doc = GraphDocument.from_dict(
        {
            "schemaVersion": 1,
            "meta": {"schemaVersion": 1, "graphId": gid, "title": "snap"},
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "nodes": [
                {"id": "s1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {
                    "id": "t1",
                    "type": "task",
                    "position": {"x": 0, "y": 0},
                    "data": {
                        "command": [sys.executable, "-c", "print('hi')"],
                        "cwd": str(tmp_path),
                    },
                },
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
                    "target": "x1",
                    "targetHandle": "in_default",
                    "condition": None,
                },
            ],
        }
    )
    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e)).run(context={"last_result": True})
    snaps = [e for e in events if e.get("type") == "node_outputs_snapshot"]
    assert len(snaps) >= 1
    snap = snaps[0].get("snapshot")
    assert isinstance(snap, dict) and isinstance(snap.get("processResult"), dict)


def test_fixture_with_gcpin_loads() -> None:
    path = GRAPH_CASTER_ROOT / "schemas" / "test-fixtures" / "task-with-gcpin.json"
    raw = json.loads(path.read_text(encoding="utf-8"))
    doc = GraphDocument.from_dict(raw)
    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e)).run(context={"last_result": True})
    assert any(e.get("type") == "node_pinned_skip" for e in events)
