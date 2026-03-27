# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
from pathlib import Path

from graph_caster.models import GraphDocument
from graph_caster.runner import GraphRunner

GRAPH_CASTER_ROOT = Path(__file__).resolve().parents[2]


def test_runner_reaches_exit_with_run_success() -> None:
    example_path = GRAPH_CASTER_ROOT / "schemas" / "graph-document.example.json"
    raw = json.loads(example_path.read_text(encoding="utf-8"))
    doc = GraphDocument.from_dict(raw)
    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e)).run(context={"last_result": True})
    types = [e["type"] for e in events]
    assert types[0] == "run_started"
    assert events[0].get("mode") == "manual"
    assert "run_success" in types
    assert events[-1]["type"] == "run_finished"
    assert events[-1].get("status") == "success"
    assert events[-2]["type"] == "run_success"
    assert events[-2].get("nodeId") == "exit1"
    assert events[-1].get("finishedAt")
    assert events[0].get("graphTitle") == "Example start → task → exit"


def test_runner_run_mode_from_context() -> None:
    example_path = GRAPH_CASTER_ROOT / "schemas" / "graph-document.example.json"
    raw = json.loads(example_path.read_text(encoding="utf-8"))
    doc = GraphDocument.from_dict(raw)
    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e)).run(context={"last_result": True, "run_mode": "cli"})
    assert events[0]["type"] == "run_started"
    assert events[0].get("mode") == "cli"


def test_runner_run_mode_non_string_coerced() -> None:
    example_path = GRAPH_CASTER_ROOT / "schemas" / "graph-document.example.json"
    raw = json.loads(example_path.read_text(encoding="utf-8"))
    doc = GraphDocument.from_dict(raw)
    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e)).run(context={"last_result": True, "run_mode": 42})
    assert events[0].get("mode") == "42"


def test_runner_root_run_id_empty_string_in_context_gets_replaced() -> None:
    gid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    doc = GraphDocument.from_dict(
        {
            "schemaVersion": 1,
            "meta": {"schemaVersion": 1, "graphId": gid, "title": "x"},
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "nodes": [
                {"id": "s", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {"id": "x", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
            ],
            "edges": [
                {
                    "id": "e",
                    "source": "s",
                    "sourceHandle": "out_default",
                    "target": "x",
                    "targetHandle": "in_default",
                    "condition": None,
                }
            ],
        }
    )
    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e)).run(context={"last_result": True, "run_id": ""})
    assert events[0]["type"] == "run_started"
    rid0 = events[0]["runId"]
    assert len(rid0) >= 16
    assert events[-1]["type"] == "run_finished"


def test_runner_root_run_id_none_in_context_gets_replaced() -> None:
    gid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    doc = GraphDocument.from_dict(
        {
            "schemaVersion": 1,
            "meta": {"schemaVersion": 1, "graphId": gid, "title": "x"},
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "nodes": [
                {"id": "s", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {"id": "x", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
            ],
            "edges": [
                {
                    "id": "e",
                    "source": "s",
                    "sourceHandle": "out_default",
                    "target": "x",
                    "targetHandle": "in_default",
                    "condition": None,
                }
            ],
        }
    )
    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e)).run(context={"last_result": True, "run_id": None})
    assert events[0]["type"] == "run_started"
    assert all(e.get("runId") == events[0]["runId"] for e in events if e.get("runId"))
    assert events[-1]["type"] == "run_finished"


def test_runner_run_mode_truncated_when_too_long() -> None:
    example_path = GRAPH_CASTER_ROOT / "schemas" / "graph-document.example.json"
    raw = json.loads(example_path.read_text(encoding="utf-8"))
    doc = GraphDocument.from_dict(raw)
    events: list[dict] = []
    long_mode = "m" * 200
    GraphRunner(doc, sink=lambda e: events.append(e)).run(context={"last_result": True, "run_mode": long_mode})
    assert len(events[0].get("mode", "")) == 128
