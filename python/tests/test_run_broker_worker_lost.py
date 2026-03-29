# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import io
import json
import queue
from pathlib import Path

import jsonschema
import pytest

from graph_caster.run_broker.registry import RunBrokerRegistry
from graph_caster.run_broker.worker_lost import (
    build_coordinator_worker_lost_run_finished_line,
    new_run_stdout_tracker,
    should_emit_coordinator_worker_lost,
    track_stdout_line_for_worker_terminal,
)

GRAPH_CASTER_ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = GRAPH_CASTER_ROOT / "schemas" / "run-event.schema.json"


def _validator():
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    return jsonschema.Draft202012Validator(schema)


def _minimal_valid_doc(graph_id: str) -> dict:
    return {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": graph_id, "title": "x"},
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


def test_build_coordinator_worker_lost_line_validates_schema() -> None:
    line = build_coordinator_worker_lost_run_finished_line(
        run_id="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        root_graph_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        worker_process_exit_code=-9,
    )
    obj = json.loads(line)
    _validator().validate(obj)
    assert obj["type"] == "run_finished"
    assert obj["status"] == "failed"
    assert obj["coordinatorWorkerLost"] is True
    assert obj["workerProcessExitCode"] == -9
    assert obj["reason"] == "coordinator_worker_lost"


def test_tracker_ignores_run_finished_with_invalid_status() -> None:
    tr = new_run_stdout_tracker()
    rid = "r1"
    track_stdout_line_for_worker_terminal(
        json.dumps(
            {
                "type": "run_started",
                "runId": rid,
                "rootGraphId": "g1",
                "startedAt": "2020-01-01T00:00:00+00:00",
                "mode": "manual",
            }
        ),
        expected_run_id=rid,
        tracker=tr,
    )
    track_stdout_line_for_worker_terminal(
        json.dumps(
            {
                "type": "run_finished",
                "runId": rid,
                "rootGraphId": "g1",
                "status": "bogus",
                "finishedAt": "2020-01-01T00:00:01+00:00",
            }
        ),
        expected_run_id=rid,
        tracker=tr,
    )
    assert should_emit_coordinator_worker_lost(tr)


def test_tracker_accepts_numeric_json_run_id() -> None:
    tr = new_run_stdout_tracker()
    track_stdout_line_for_worker_terminal(
        json.dumps(
            {
                "type": "run_started",
                "runId": 42,
                "rootGraphId": "g9",
                "startedAt": "2020-01-01T00:00:00+00:00",
                "mode": "manual",
            }
        ),
        expected_run_id="42",
        tracker=tr,
    )
    assert tr["root_graph_id"] == "g9"


def test_tracker_marks_run_finished() -> None:
    tr = new_run_stdout_tracker()
    rid = "r1"
    track_stdout_line_for_worker_terminal(
        json.dumps(
            {
                "type": "run_started",
                "runId": rid,
                "rootGraphId": "g1",
                "startedAt": "2020-01-01T00:00:00+00:00",
                "mode": "manual",
            }
        ),
        expected_run_id=rid,
        tracker=tr,
    )
    assert tr["root_graph_id"] == "g1"
    assert should_emit_coordinator_worker_lost(tr)
    track_stdout_line_for_worker_terminal(
        json.dumps(
            {
                "type": "run_finished",
                "runId": rid,
                "rootGraphId": "g1",
                "status": "success",
                "finishedAt": "2020-01-01T00:00:01+00:00",
            }
        ),
        expected_run_id=rid,
        tracker=tr,
    )
    assert not should_emit_coordinator_worker_lost(tr)


def test_run_broker_emits_synthetic_when_worker_exits_without_run_finished(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    gid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

    class FP:
        def __init__(self, *a, **k) -> None:
            self.stdout = io.StringIO(
                json.dumps(
                    {
                        "type": "run_started",
                        "runId": rid,
                        "rootGraphId": gid,
                        "startedAt": "2020-01-01T00:00:00+00:00",
                        "mode": "manual",
                    }
                )
                + "\n"
            )
            self.stderr = io.StringIO("")
            self.stdin = io.StringIO()
            self.returncode: int | None = None

        def wait(self, timeout=None):  # noqa: ANN001
            self.returncode = 42
            return 42

    monkeypatch.setattr("graph_caster.run_broker.registry.subprocess.Popen", FP)

    reg = RunBrokerRegistry()
    doc = json.dumps(_minimal_valid_doc(gid))
    sp = reg.spawn_from_body({"documentJson": doc, "runId": rid})
    assert sp.run_id == rid
    entry = reg.get(rid)
    assert entry is not None
    q: queue.Queue[object] = entry.broadcaster.subscribe()
    saw_synthetic = False
    for _ in range(500):
        try:
            m = q.get(timeout=3.0)
        except queue.Empty:
            pytest.fail("timed out waiting for broker messages")
        if m.kind == "out" and "coordinatorWorkerLost" in m.payload:
            saw_synthetic = True
            obj = json.loads(m.payload)
            _validator().validate(obj)
            assert obj["workerProcessExitCode"] == 42
        if m.kind == "exit":
            break
    assert saw_synthetic


def test_run_broker_cancel_after_run_finished_returns_false(monkeypatch: pytest.MonkeyPatch) -> None:
    rid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    gid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"

    class FP:
        def __init__(self, *a, **k) -> None:
            self.stdout = io.StringIO(
                json.dumps(
                    {
                        "type": "run_started",
                        "runId": rid,
                        "rootGraphId": gid,
                        "startedAt": "2020-01-01T00:00:00+00:00",
                        "mode": "manual",
                    }
                )
                + "\n"
                + json.dumps(
                    {
                        "type": "run_finished",
                        "runId": rid,
                        "rootGraphId": gid,
                        "status": "success",
                        "finishedAt": "2020-01-01T00:00:01+00:00",
                    }
                )
                + "\n"
            )
            self.stderr = io.StringIO("")
            self.stdin = io.StringIO()
            self.returncode: int | None = None

        def wait(self, timeout=None):  # noqa: ANN001
            self.returncode = 0
            return 0

    monkeypatch.setattr("graph_caster.run_broker.registry.subprocess.Popen", FP)

    reg = RunBrokerRegistry()
    reg.spawn_from_body({"documentJson": json.dumps(_minimal_valid_doc(gid)), "runId": rid})
    entry = reg.get(rid)
    assert entry is not None
    q: queue.Queue[object] = entry.broadcaster.subscribe()
    for _ in range(500):
        m = q.get(timeout=3.0)
        if m.kind == "exit":
            break
    assert reg.get(rid) is None
    assert reg.cancel(rid) is False
