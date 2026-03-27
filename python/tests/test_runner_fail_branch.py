# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
import sys
import threading
from pathlib import Path

from graph_caster.host_context import RunHostContext
from graph_caster.models import GraphDocument
from graph_caster.runner import GraphRunner
from graph_caster.run_sessions import RunSessionRegistry
from graph_caster.workspace import clear_graph_index_cache


def _write(tmp: Path, name: str, doc: dict) -> Path:
    path = tmp / name
    path.write_text(json.dumps(doc), encoding="utf-8")
    return path


def test_task_failure_out_error_routes_to_recovery_then_success(tmp_path: Path) -> None:
    gid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    doc = GraphDocument.from_dict(
        {
            "schemaVersion": 1,
            "meta": {"schemaVersion": 1, "graphId": gid, "title": "fail-branch"},
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "nodes": [
                {"id": "s1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {
                    "id": "bad",
                    "type": "task",
                    "position": {"x": 0, "y": 0},
                    "data": {
                        "command": [sys.executable, "-c", "raise SystemExit(7)"],
                        "cwd": str(tmp_path),
                        "retryCount": 0,
                    },
                },
                {
                    "id": "ok",
                    "type": "task",
                    "position": {"x": 0, "y": 0},
                    "data": {
                        "command": [sys.executable, "-c", "raise SystemExit(0)"],
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
                    "target": "bad",
                    "targetHandle": "in_default",
                    "condition": None,
                },
                {
                    "id": "e_err",
                    "source": "bad",
                    "sourceHandle": "out_error",
                    "target": "ok",
                    "targetHandle": "in_default",
                    "condition": None,
                },
                {
                    "id": "e1",
                    "source": "ok",
                    "sourceHandle": "out_default",
                    "target": "x1",
                    "targetHandle": "in_default",
                    "condition": None,
                },
            ],
        }
    )
    events: list[dict] = []
    GraphRunner(doc, sink=lambda e: events.append(e), host=RunHostContext(artifacts_base=tmp_path)).run(
        context={"last_result": True}
    )
    assert events[-1]["type"] == "run_finished"
    assert events[-1].get("status") == "success"
    tr_err = [e for e in events if e.get("type") == "edge_traverse" and e.get("edgeId") == "e_err"]
    assert len(tr_err) == 1
    assert tr_err[0].get("route") == "error"
    assert any(e.get("type") == "run_success" for e in events)


def test_task_failure_without_out_error_still_failed(tmp_path: Path) -> None:
    gid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    doc = GraphDocument.from_dict(
        {
            "schemaVersion": 1,
            "meta": {"schemaVersion": 1, "graphId": gid, "title": "no-fail-branch"},
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "nodes": [
                {"id": "s1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {
                    "id": "bad",
                    "type": "task",
                    "position": {"x": 0, "y": 0},
                    "data": {
                        "command": [sys.executable, "-c", "raise SystemExit(7)"],
                        "cwd": str(tmp_path),
                        "retryCount": 0,
                    },
                },
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
                    "id": "e1",
                    "source": "bad",
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
    assert events[-1].get("status") == "failed"
    assert not any(e.get("route") == "error" for e in events)


def test_graph_ref_nested_failure_out_error_recover(tmp_path: Path) -> None:
    clear_graph_index_cache()
    child_id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    parent_id = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
    failing_child = {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": child_id, "title": "child"},
        "viewport": {"x": 0, "y": 0, "zoom": 1},
        "nodes": [
            {"id": "cs", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {
                "id": "ct",
                "type": "task",
                "position": {"x": 0, "y": 0},
                "data": {
                    "command": [sys.executable, "-c", "raise SystemExit(9)"],
                    "cwd": str(tmp_path),
                    "retryCount": 0,
                },
            },
            {"id": "ce", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
        ],
        "edges": [
            {
                "id": "k1",
                "source": "cs",
                "sourceHandle": "out_default",
                "target": "ct",
                "targetHandle": "in_default",
                "condition": None,
            },
            {
                "id": "k2",
                "source": "ct",
                "sourceHandle": "out_default",
                "target": "ce",
                "targetHandle": "in_default",
                "condition": None,
            },
        ],
    }
    _write(tmp_path, "child.json", failing_child)
    parent = {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": parent_id, "title": "parent"},
        "viewport": {"x": 0, "y": 0, "zoom": 1},
        "nodes": [
            {"id": "ps", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {"id": "pref", "type": "graph_ref", "position": {"x": 0, "y": 0}, "data": {"targetGraphId": child_id}},
            {
                "id": "fix",
                "type": "task",
                "position": {"x": 0, "y": 0},
                "data": {
                    "command": [sys.executable, "-c", "raise SystemExit(0)"],
                    "cwd": str(tmp_path),
                },
            },
            {"id": "pe", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
        ],
        "edges": [
            {
                "id": "p0",
                "source": "ps",
                "sourceHandle": "out_default",
                "target": "pref",
                "targetHandle": "in_default",
                "condition": None,
            },
            {
                "id": "p_err",
                "source": "pref",
                "sourceHandle": "out_error",
                "target": "fix",
                "targetHandle": "in_default",
                "condition": None,
            },
            {
                "id": "p1",
                "source": "fix",
                "sourceHandle": "out_default",
                "target": "pe",
                "targetHandle": "in_default",
                "condition": None,
            },
        ],
    }
    _write(tmp_path, "parent.json", parent)
    root_doc = GraphDocument.from_dict(parent)
    events: list[dict] = []
    GraphRunner(root_doc, sink=lambda e: events.append(e), host=RunHostContext(graphs_root=tmp_path)).run(
        context={"last_result": True}
    )
    assert events[-1]["type"] == "run_finished"
    assert events[-1].get("status") == "success"
    perr = [e for e in events if e.get("type") == "edge_traverse" and e.get("edgeId") == "p_err"]
    assert len(perr) == 1
    assert perr[0].get("route") == "error"


def test_task_cancel_does_not_follow_out_error_even_if_present(tmp_path: Path) -> None:
    gid = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
    reg = RunSessionRegistry()
    doc = GraphDocument.from_dict(
        {
            "schemaVersion": 1,
            "meta": {"schemaVersion": 1, "graphId": gid, "title": "cancel-no-error-route"},
            "viewport": {"x": 0, "y": 0, "zoom": 1},
            "nodes": [
                {"id": "s1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {
                    "id": "slow",
                    "type": "task",
                    "position": {"x": 0, "y": 0},
                    "data": {
                        "command": [sys.executable, "-c", "import time; time.sleep(120)"],
                        "cwd": str(tmp_path),
                        "retryCount": 0,
                    },
                },
                {
                    "id": "recover",
                    "type": "task",
                    "position": {"x": 0, "y": 0},
                    "data": {
                        "command": [sys.executable, "-c", "raise SystemExit(0)"],
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
                    "target": "slow",
                    "targetHandle": "in_default",
                    "condition": None,
                },
                {
                    "id": "e_err",
                    "source": "slow",
                    "sourceHandle": "out_error",
                    "target": "recover",
                    "targetHandle": "in_default",
                    "condition": None,
                },
                {
                    "id": "e_ok",
                    "source": "recover",
                    "sourceHandle": "out_default",
                    "target": "x1",
                    "targetHandle": "in_default",
                    "condition": None,
                },
            ],
        }
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
    resume.set()
    th.join(timeout=15.0)
    assert not th.is_alive()
    assert events[-1].get("status") == "cancelled"
    assert not any(
        e.get("type") == "edge_traverse" and e.get("edgeId") == "e_err" for e in events
    )
    assert not any(e.get("type") == "node_enter" and e.get("nodeId") == "recover" for e in events)
