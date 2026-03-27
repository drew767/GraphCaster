# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import sys
import threading
import time
from pathlib import Path

from graph_caster.host_context import RunHostContext
from graph_caster.models import GraphDocument
from graph_caster.runner import GraphRunner
from graph_caster.run_sessions import RunSessionRegistry


def _linear_doc(
    graph_id: str,
    *,
    task_data: dict,
    start: str = "s1",
    task: str = "t1",
    exit_id: str = "x1",
) -> dict:
    return {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": graph_id, "title": "p"},
        "viewport": {"x": 0, "y": 0, "zoom": 1},
        "nodes": [
            {"id": start, "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {"id": task, "type": "task", "position": {"x": 0, "y": 0}, "data": task_data},
            {"id": exit_id, "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
        ],
        "edges": [
            {
                "id": "e1",
                "source": start,
                "sourceHandle": "out_default",
                "target": task,
                "targetHandle": "in_default",
                "condition": None,
            },
            {
                "id": "e2",
                "source": task,
                "sourceHandle": "out_default",
                "target": exit_id,
                "targetHandle": "in_default",
                "condition": None,
            },
        ],
    }


def test_task_process_exit_code_success(tmp_path: Path) -> None:
    gid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    doc = GraphDocument.from_dict(
        _linear_doc(
            gid,
            task_data={"command": [sys.executable, "-c", "raise SystemExit(0)"], "cwd": str(tmp_path)},
        )
    )
    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e), host=RunHostContext(artifacts_base=tmp_path)).run(
        context={"last_result": True}
    )
    assert events[-1]["type"] == "run_finished"
    assert events[-1].get("status") == "success"
    assert events[-2]["type"] == "run_success"
    assert any(e["type"] == "process_complete" and e.get("success") is True for e in events)


def test_task_process_spawns_and_failure_stops_run(tmp_path: Path) -> None:
    gid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    doc = GraphDocument.from_dict(
        _linear_doc(
            gid,
            task_data={
                "command": [sys.executable, "-c", "raise SystemExit(7)"],
                "cwd": str(tmp_path),
                "retryCount": 0,
            },
        )
    )
    events: list[dict] = []
    ctx: dict = {"last_result": True}
    GraphRunner(doc, sink=lambda e: events.append(e)).run(context=ctx)
    assert any(e["type"] == "process_failed" for e in events)
    assert not any(e["type"] == "run_success" for e in events)
    assert events[-1]["type"] == "run_finished"
    assert events[-1].get("status") == "failed"
    assert events[-1].get("finishedAt")
    pr = ctx.get("node_outputs", {}).get("t1", {}).get("processResult")
    assert pr is not None
    assert pr.get("exitCode") == 7
    assert pr.get("success") is False
    assert pr.get("timedOut") is False
    assert pr.get("cancelled") is False


def test_task_process_stdout_mode(tmp_path: Path) -> None:
    gid = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    doc = GraphDocument.from_dict(
        _linear_doc(
            gid,
            task_data={
                "command": [sys.executable, "-c", "print('needle_ok')"],
                "cwd": str(tmp_path),
                "successMode": "stdout",
                "stdoutContains": "needle_ok",
            },
        )
    )
    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e)).run(context={"last_result": True})
    assert events[-1]["type"] == "run_finished"
    assert events[-1].get("status") == "success"


def test_task_process_marker_file_mode(tmp_path: Path) -> None:
    gid = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
    doc = GraphDocument.from_dict(
        _linear_doc(
            gid,
            task_data={
                "command": [
                    sys.executable,
                    "-c",
                    "open('done.flag','wb').close()",
                ],
                "cwd": str(tmp_path),
                "successMode": "marker_file",
                "markerFile": "done.flag",
            },
        )
    )
    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e)).run(context={"last_result": True})
    assert events[-1]["type"] == "run_finished"
    assert events[-1].get("status") == "success"
    assert (tmp_path / "done.flag").is_file()


def test_task_process_retry_then_success(tmp_path: Path) -> None:
    gid = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
    script = tmp_path / "flip.py"
    script.write_text(
        "\n".join(
            [
                "from pathlib import Path",
                "p = Path('state.txt')",
                "if not p.exists():",
                "    p.write_text('1')",
                "    raise SystemExit(1)",
                "raise SystemExit(0)",
                "",
            ]
        ),
        encoding="utf-8",
    )
    doc = GraphDocument.from_dict(
        _linear_doc(
            gid,
            task_data={
                "command": [sys.executable, str(script)],
                "cwd": str(tmp_path),
                "retryCount": 1,
                "retryBackoffSec": 0.01,
            },
        )
    )
    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e)).run(context={"last_result": True})
    assert events[-1]["type"] == "run_finished"
    assert events[-1].get("status") == "success"
    assert sum(1 for e in events if e["type"] == "process_retry") == 1


def test_task_process_env_merged(tmp_path: Path) -> None:
    gid = "99999999-9999-4999-8999-999999999999"
    doc = GraphDocument.from_dict(
        _linear_doc(
            gid,
            task_data={
                "command": [sys.executable, "-c", "import os; print(os.environ.get('GC_GCASTER_TEST',''))"],
                "cwd": str(tmp_path),
                "env": {"GC_GCASTER_TEST": "from_env"},
                "successMode": "stdout",
                "stdoutContains": "from_env",
            },
        )
    )
    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e)).run(context={"last_result": True})
    assert events[-1]["type"] == "run_finished"
    assert events[-1].get("status") == "success"


def test_task_process_timeout(tmp_path: Path) -> None:
    gid = "ffffffff-ffff-4fff-8fff-ffffffffffff"
    doc = GraphDocument.from_dict(
        _linear_doc(
            gid,
            task_data={
                "command": [sys.executable, "-c", "import time; time.sleep(60)"],
                "cwd": str(tmp_path),
                "timeoutSec": 0.5,
                "retryCount": 0,
            },
        )
    )
    events: list[dict] = []
    t0 = time.monotonic()
    GraphRunner(doc, sink=lambda e: events.append(e)).run(context={"last_result": True})
    assert time.monotonic() - t0 < 5.0
    assert any(e["type"] == "process_complete" and e.get("timedOut") for e in events)
    assert any(e["type"] == "process_failed" for e in events)
    assert events[-1]["type"] == "run_finished"
    assert events[-1].get("status") == "failed"
    assert events[-1].get("finishedAt")


def test_runner_cancel_kills_long_running_task(tmp_path: Path) -> None:
    gid = "abababab-abab-4bab-8bab-abababababab"
    reg = RunSessionRegistry()
    doc = GraphDocument.from_dict(
        _linear_doc(
            gid,
            task_data={
                "command": [sys.executable, "-c", "import time; time.sleep(120)"],
                "cwd": str(tmp_path),
                "retryCount": 0,
            },
        )
    )
    started = threading.Event()
    spawned = threading.Event()
    resume = threading.Event()
    run_ids: list[str] = []
    events: list[dict] = []

    def sink(ev: dict) -> None:
        events.append(ev)
        if ev.get("type") == "run_started":
            run_ids.append(ev["runId"])
            started.set()
        if ev.get("type") == "process_spawn":
            spawned.set()
            assert resume.wait(timeout=15.0)

    def work() -> None:
        GraphRunner(
            doc,
            sink=sink,
            host=RunHostContext(artifacts_base=tmp_path),
            session_registry=reg,
        ).run(context={"last_result": True})

    th = threading.Thread(target=work)
    th.start()
    assert started.wait(timeout=5.0)
    assert spawned.wait(timeout=5.0)
    assert reg.request_cancel(run_ids[0])
    t0 = time.monotonic()
    resume.set()
    th.join(timeout=15.0)
    assert time.monotonic() - t0 < 10.0
    assert not th.is_alive()
    assert any(e.get("type") == "process_complete" and e.get("cancelled") is True for e in events)
    assert events[-1].get("type") == "run_finished"
    assert events[-1].get("status") == "cancelled"
