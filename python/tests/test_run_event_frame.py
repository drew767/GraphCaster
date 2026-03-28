# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json

import jsonschema.exceptions
import pytest

from graph_caster.run_transport import frame_from_ndjson_line, ndjson_line_from_event


def test_ndjson_line_from_event_roundtrip() -> None:
    ev = {
        "type": "run_started",
        "runId": "550e8400-e29b-41d4-a716-422039440000",
        "rootGraphId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "startedAt": "2026-03-29T00:00:00Z",
        "mode": "manual",
    }
    line = ndjson_line_from_event(ev)
    assert line == json.dumps(ev, ensure_ascii=False, separators=(",", ":"))
    w = frame_from_ndjson_line(line)
    assert w["runId"] == ev["runId"]
    assert w["event"] == ev


def test_frame_from_ndjson_line_rejects_garbage() -> None:
    with pytest.raises(ValueError, match="invalid json"):
        frame_from_ndjson_line("not-json")
    with pytest.raises(ValueError, match="empty"):
        frame_from_ndjson_line("   ")
    with pytest.raises(ValueError, match="invalid json"):
        frame_from_ndjson_line('{"type":"run_started"}\n{"type":"run_finished"}')


def test_frame_from_ndjson_line_requires_run_id() -> None:
    with pytest.raises(ValueError, match="runId"):
        frame_from_ndjson_line(
            '{"type":"stream_backpressure","runId":"  ","droppedOutputLines":1,"reason":"subscriber_queue_full"}',
        )


def test_frame_from_ndjson_line_validates_schema() -> None:
    bad = '{"type":"no_such_event_ever","runId":"550e8400-e29b-41d4-a716-422039440000"}'
    with pytest.raises(jsonschema.exceptions.ValidationError):
        frame_from_ndjson_line(bad)
    frame_from_ndjson_line(bad, validate_schema=False)
