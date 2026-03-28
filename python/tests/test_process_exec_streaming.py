# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import sys
import threading
import time
from pathlib import Path

import jsonschema
from graph_caster.process_exec import run_task_process

GRAPH_CASTER_ROOT = Path(__file__).resolve().parents[2]
SCHEMA_PATH = GRAPH_CASTER_ROOT / "schemas" / "run-event.schema.json"


def _validator():
    import json

    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    return jsonschema.Draft202012Validator(schema)


def _emit_collect(events: list[dict], run_id: str):
    v = _validator()

    def emit(event_type: str, **payload):
        ev = {"type": event_type, **payload, "runId": run_id}
        v.validate(ev)
        events.append(ev)

    return emit


def test_run_task_process_emits_process_output_lines(tmp_path: Path) -> None:
    events: list[dict] = []
    rid = "550e8400-e29b-41d4-a716-422039440099"
    emit = _emit_collect(events, rid)
    ctx = {"last_result": True, "root_run_artifact_dir": str(tmp_path)}
    data = {
        "command": [sys.executable, "-c", "print('a'); print('b')"],
        "successMode": "exit_code",
    }
    ok = run_task_process(
        node_id="n1",
        graph_id="g1",
        data=data,
        ctx=ctx,
        emit=emit,
        should_cancel=None,
    )
    assert ok is True
    out_ev = [e for e in events if e.get("type") == "process_output" and e.get("stream") == "stdout"]
    texts = [e["text"] for e in out_ev]
    assert "a\n" in texts and "b\n" in texts
    seqs = [e["seq"] for e in out_ev]
    assert seqs == list(range(len(seqs)))


def test_run_task_process_streams_stderr(tmp_path: Path) -> None:
    events: list[dict] = []
    rid = "550e8400-e29b-41d4-a716-42203944009a"
    emit = _emit_collect(events, rid)
    ctx = {"last_result": True, "root_run_artifact_dir": str(tmp_path)}
    data = {
        "command": [
            sys.executable,
            "-c",
            "import sys; print('e', file=sys.stderr); sys.stderr.flush()",
        ],
        "successMode": "exit_code",
    }
    ok = run_task_process(node_id="n1", graph_id="g1", data=data, ctx=ctx, emit=emit, should_cancel=None)
    assert ok is True
    err_lines = [e for e in events if e.get("type") == "process_output" and e.get("stream") == "stderr"]
    assert len(err_lines) >= 1
    joined = "".join(e["text"] for e in err_lines)
    assert "e" in joined


def test_run_task_process_cancel_during_stream(tmp_path: Path) -> None:
    events: list[dict] = []
    rid = "550e8400-e29b-41d4-a716-42203944009b"
    emit = _emit_collect(events, rid)
    ctx = {"last_result": True, "root_run_artifact_dir": str(tmp_path)}
    data = {
        "command": [
            sys.executable,
            "-c",
            "import time\n"
            "for i in range(500):\n"
            "    print(i, flush=True)\n"
            "    time.sleep(0.02)\n",
        ],
        "successMode": "exit_code",
    }
    cancel_state = {"cancel": False}
    errors: list[BaseException] = []

    def work() -> None:
        try:
            run_task_process(
                node_id="n1",
                graph_id="g1",
                data=data,
                ctx=ctx,
                emit=emit,
                should_cancel=lambda: cancel_state["cancel"],
            )
        except BaseException as e:
            errors.append(e)

    th = threading.Thread(target=work, daemon=True)
    th.start()
    time.sleep(0.08)
    cancel_state["cancel"] = True
    th.join(timeout=30.0)
    assert not th.is_alive(), "run_task_process did not finish after cancel"
    assert not errors, errors
    out_ev = [e for e in events if e.get("type") == "process_output" and e.get("stream") == "stdout"]
    assert len(out_ev) >= 1
    complete = [e for e in events if e.get("type") == "process_complete"]
    assert any(e.get("cancelled") is True for e in complete), complete
