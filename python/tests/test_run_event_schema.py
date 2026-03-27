# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
from pathlib import Path

import jsonschema
from graph_caster.models import GraphDocument
from graph_caster.runner import GraphRunner

GRAPH_CASTER_ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = GRAPH_CASTER_ROOT / "schemas" / "run-event.schema.json"


def _validator():
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    return jsonschema.Draft202012Validator(schema)


def test_example_graph_events_validate_against_run_event_schema() -> None:
    example_path = GRAPH_CASTER_ROOT / "schemas" / "graph-document.example.json"
    raw = json.loads(example_path.read_text(encoding="utf-8"))
    doc = GraphDocument.from_dict(raw)
    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e)).run(context={"last_result": True})
    validator = _validator()
    for ev in events:
        validator.validate(ev)


def test_process_like_events_validate() -> None:
    validator = _validator()
    samples = [
        {
            "type": "process_spawn",
            "nodeId": "t1",
            "graphId": "g1",
            "argv": ["cmd", "/c", "echo", "hi"],
            "cwd": ".",
            "attempt": 0,
        },
        {
            "type": "process_complete",
            "nodeId": "t1",
            "graphId": "g1",
            "exitCode": 0,
            "timedOut": False,
            "attempt": 0,
            "success": True,
            "stdoutTail": "",
            "stderrTail": "",
        },
        {
            "type": "process_complete",
            "nodeId": "t1",
            "graphId": "g1",
            "exitCode": 1,
            "timedOut": False,
            "attempt": 0,
            "success": False,
            "cancelled": True,
            "stdoutTail": "",
            "stderrTail": "",
        },
        {
            "type": "process_retry",
            "nodeId": "t1",
            "graphId": "g1",
            "attempt": 1,
            "delaySec": 1.0,
            "reason": "timeout",
        },
        {
            "type": "process_failed",
            "nodeId": "t1",
            "graphId": "g1",
            "reason": "spawn_error",
            "message": "enoent",
            "attempt": 0,
        },
    ]
    for ev in samples:
        validator.validate(ev)
    for ev in (
        {
            "type": "branch_taken",
            "edgeId": "e1",
            "fromNode": "a",
            "toNode": "b",
            "graphId": "g1",
        },
        {
            "type": "branch_taken",
            "edgeId": "e_err",
            "fromNode": "t1",
            "toNode": "r1",
            "graphId": "g1",
            "route": "error",
        },
        {
            "type": "edge_traverse",
            "edgeId": "e_err",
            "fromNode": "t1",
            "toNode": "r1",
            "route": "error",
        },
        {
            "type": "branch_skipped",
            "edgeId": "e0",
            "fromNode": "a",
            "toNode": "c",
            "graphId": "g1",
            "reason": "condition_false",
        },
        {
            "type": "run_started",
            "runId": "550e8400-e29b-41d4-a716-446655440000",
            "rootGraphId": "g1",
            "startedAt": "2026-03-27T12:00:00+00:00",
            "mode": "manual",
            "graphTitle": "Demo",
        },
        {
            "type": "run_finished",
            "runId": "550e8400-e29b-41d4-a716-446655440000",
            "rootGraphId": "g1",
            "status": "success",
            "finishedAt": "2026-03-27T12:00:01+00:00",
        },
        {
            "type": "run_finished",
            "runId": "550e8400-e29b-41d4-a716-446655440001",
            "rootGraphId": "g1",
            "status": "cancelled",
            "finishedAt": "2026-03-27T12:00:02+00:00",
            "reason": "cancel_requested",
        },
    ):
        validator.validate(ev)
