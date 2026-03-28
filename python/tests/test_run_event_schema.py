# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
from pathlib import Path

import jsonschema
import pytest
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
        {
            "type": "process_output",
            "runId": "550e8400-e29b-41d4-a716-422039440000",
            "nodeId": "t1",
            "graphId": "g1",
            "stream": "stdout",
            "text": "hello\n",
            "seq": 0,
            "attempt": 0,
            "eol": True,
        },
        {
            "type": "process_output",
            "runId": "550e8400-e29b-41d4-a716-422039440000",
            "nodeId": "t1",
            "graphId": "g1",
            "stream": "stderr",
            "text": "warn\n",
            "seq": 0,
            "eol": True,
        },
        {
            "type": "structure_warning",
            "kind": "merge_few_inputs",
            "nodeId": "m1",
            "incomingEdges": 1,
            "graphId": "g1",
        },
        {
            "type": "structure_warning",
            "kind": "fork_few_outputs",
            "nodeId": "f1",
            "unconditionalOutgoing": 1,
            "graphId": "g1",
        },
        {
            "type": "structure_warning",
            "kind": "barrier_merge_out_error_incoming",
            "edgeId": "e1",
            "mergeNodeId": "m1",
            "graphId": "g1",
        },
        {
            "type": "structure_warning",
            "kind": "barrier_merge_no_success_incoming",
            "nodeId": "m1",
            "graphId": "g1",
        },
        {
            "type": "node_cache_hit",
            "nodeId": "t1",
            "graphId": "g1",
            "keyPrefix": "a1b2c3d4e5f67890",
        },
        {
            "type": "node_cache_miss",
            "nodeId": "t1",
            "graphId": "g1",
            "keyPrefix": "a1b2c3d4e5f67890",
            "reason": "dirty",
        },
        {
            "type": "node_cache_miss",
            "nodeId": "t1",
            "graphId": "g1",
            "reason": "upstream_incomplete",
        },
        {
            "type": "structure_warning",
            "kind": "gc_pin_enabled_empty_payload",
            "nodeId": "t1",
            "graphId": "g1",
        },
        {
            "type": "structure_warning",
            "kind": "ai_route_no_outgoing",
            "nodeId": "ar1",
            "outgoingEdges": 0,
            "graphId": "g1",
        },
        {
            "type": "structure_warning",
            "kind": "ai_route_missing_route_descriptions",
            "nodeId": "ar1",
            "outgoingEdges": 3,
            "missingDescriptions": 2,
            "graphId": "g1",
        },
        {
            "type": "ai_route_invoke",
            "runId": "550e8400-e29b-41d4-a716-422039440000",
            "nodeId": "ar1",
            "graphId": "g1",
            "outgoingCount": 2,
            "requestBytes": 120,
        },
        {
            "type": "ai_route_decided",
            "runId": "550e8400-e29b-41d4-a716-422039440000",
            "nodeId": "ar1",
            "graphId": "g1",
            "choiceIndex": 1,
            "edgeId": "e1",
        },
        {
            "type": "ai_route_failed",
            "runId": "550e8400-e29b-41d4-a716-422039440000",
            "nodeId": "ar1",
            "graphId": "g1",
            "reason": "empty_endpoint",
            "detail": "no url",
        },
        {
            "type": "node_pinned_skip",
            "nodeId": "t1",
            "graphId": "g1",
        },
        {
            "type": "node_outputs_snapshot",
            "nodeId": "t1",
            "graphId": "g1",
            "snapshot": {"processResult": {"success": True, "exitCode": 0}},
        },
        {
            "type": "node_exit",
            "nodeId": "t1",
            "nodeType": "task",
            "graphId": "g1",
            "usedPin": True,
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
            "type": "branch_skipped",
            "edgeId": "e2",
            "fromNode": "a",
            "toNode": "c",
            "graphId": "g1",
            "reason": "ai_route_not_selected",
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
        {
            "type": "run_finished",
            "runId": "550e8400-e29b-41d4-a716-446655440002",
            "rootGraphId": "g1",
            "status": "partial",
            "finishedAt": "2026-03-27T12:00:03+00:00",
        },
    ):
        validator.validate(ev)


def test_stream_backpressure_validates() -> None:
    validator = _validator()
    ok = {
        "type": "stream_backpressure",
        "runId": "550e8400-e29b-41d4-a716-446655440099",
        "droppedOutputLines": 42,
        "reason": "subscriber_queue_full",
    }
    validator.validate(ok)
    validator.validate(
        {
            "type": "stream_backpressure",
            "runId": "550e8400-e29b-41d4-a716-446655440099",
            "droppedOutputLines": 1,
        }
    )


def test_stream_backpressure_requires_dropped_output_lines() -> None:
    validator = _validator()
    bad = {
        "type": "stream_backpressure",
        "runId": "550e8400-e29b-41d4-a716-446655440099",
    }
    with pytest.raises(jsonschema.ValidationError):
        validator.validate(bad)


def test_process_output_schema_requires_seq() -> None:
    validator = _validator()
    bad = {
        "type": "process_output",
        "runId": "550e8400-e29b-41d4-a716-422039440001",
        "nodeId": "t1",
        "graphId": "g1",
        "stream": "stdout",
        "text": "x",
    }
    with pytest.raises(jsonschema.ValidationError):
        validator.validate(bad)
