# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
import sys
import threading
from pathlib import Path

import pytest

from graph_caster.host_context import RunHostContext
from graph_caster.models import GraphDocument
from graph_caster.runner import GraphRunner
from graph_caster.run_sessions import RunSessionRegistry
from graph_caster.workspace import clear_graph_index_cache


def _write(tmp: Path, name: str, doc: dict) -> Path:
    path = tmp / name
    path.write_text(json.dumps(doc), encoding="utf-8")
    return path


def _chain_graph(
    graph_id: str,
    start: str,
    mid: str,
    end: str,
    *,
    mid_type: str = "task",
    mid_data: dict | None = None,
) -> dict:
    data = mid_data if mid_data is not None else {"title": mid}
    return {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": graph_id, "title": graph_id[:8]},
        "viewport": {"x": 0, "y": 0, "zoom": 1},
        "nodes": [
            {"id": start, "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {"id": mid, "type": mid_type, "position": {"x": 0, "y": 0}, "data": data},
            {"id": end, "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
        ],
        "edges": [
            {
                "id": "k1",
                "source": start,
                "sourceHandle": "out_default",
                "target": mid,
                "targetHandle": "in_default",
                "condition": None,
            },
            {
                "id": "k2",
                "source": mid,
                "sourceHandle": "out_default",
                "target": end,
                "targetHandle": "in_default",
                "condition": None,
            },
        ],
    }


@pytest.fixture
def graph_ref_workspace(tmp_path: Path) -> tuple[str, str, GraphDocument]:
    clear_graph_index_cache()
    child_id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
    parent_id = "ffffffff-ffff-4fff-8fff-ffffffffffff"
    _write(tmp_path, "child.json", _chain_graph(child_id, "cs", "ct", "ce"))
    parent = _chain_graph(
        parent_id, "ps", "pref", "pe", mid_type="graph_ref", mid_data={"targetGraphId": child_id}
    )
    _write(tmp_path, "parent.json", parent)
    return child_id, parent_id, GraphDocument.from_dict(parent)


def test_graph_ref_subprocess_success_matches_inprocess_events(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, graph_ref_workspace: tuple[str, str, GraphDocument]
) -> None:
    child_id, parent_id, root_doc = graph_ref_workspace
    monkeypatch.setenv("GC_GRAPH_REF_SUBPROCESS", "1")

    events: list[dict] = []
    GraphRunner(root_doc, sink=lambda e: events.append(e), host=RunHostContext(graphs_root=tmp_path)).run(
        context={"last_result": True}
    )
    types = [e["type"] for e in events]
    run_ids = {e.get("runId") for e in events if e.get("runId")}
    assert len(run_ids) == 1
    assert types.count("run_success") == 2
    assert events[-1]["type"] == "run_finished"
    assert events[-1].get("status") == "success"
    assert events[-2]["type"] == "run_success"
    assert events[-2]["nodeId"] == "pe"
    assert events[-2]["graphId"] == parent_id
    assert "nested_graph_enter" in types
    assert "nested_graph_exit" in types
    assert events[types.index("nested_graph_enter")]["targetGraphId"] == child_id
    assert sum(1 for e in events if e.get("graphId") == child_id and e.get("type") == "node_enter") >= 1


def test_graph_ref_default_still_inprocess(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("GC_GRAPH_REF_SUBPROCESS", raising=False)
    clear_graph_index_cache()
    child_id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    parent_id = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    _write(tmp_path, "child.json", _chain_graph(child_id, "cs", "ct", "ce"))
    parent = _chain_graph(
        parent_id, "ps", "pref", "pe", mid_type="graph_ref", mid_data={"targetGraphId": child_id}
    )
    _write(tmp_path, "parent.json", parent)
    root_doc = GraphDocument.from_dict(parent)
    events: list[dict] = []
    GraphRunner(root_doc, sink=lambda e: events.append(e), host=RunHostContext(graphs_root=tmp_path)).run(
        context={"last_result": True}
    )
    types = [e["type"] for e in events]
    assert types.count("run_success") == 2
    assert events[-1].get("status") == "success"


def test_graph_ref_subprocess_child_task_failure(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("GC_GRAPH_REF_SUBPROCESS", "1")
    clear_graph_index_cache()
    child_id = "66666666-6666-4666-8666-666666666666"
    parent_id = "77777777-7777-4777-8777-777777777777"
    failing_child = _chain_graph(
        child_id,
        "cs",
        "ct",
        "ce",
        mid_type="task",
        mid_data={
            "command": [sys.executable, "-c", "raise SystemExit(7)"],
            "cwd": str(tmp_path),
            "retryCount": 0,
        },
    )
    _write(tmp_path, "child.json", failing_child)
    parent = _chain_graph(
        parent_id, "ps", "pref", "pe", mid_type="graph_ref", mid_data={"targetGraphId": child_id}
    )
    _write(tmp_path, "parent.json", parent)
    root_doc = GraphDocument.from_dict(parent)
    events: list[dict] = []
    GraphRunner(root_doc, sink=lambda e: events.append(e), host=RunHostContext(graphs_root=tmp_path)).run(
        context={"last_result": True}
    )
    assert any(e["type"] == "nested_graph_exit" for e in events)
    assert any(
        e["type"] == "error" and e.get("message") == "nested_graph_run_incomplete" for e in events
    )
    assert not any(e["type"] == "run_success" for e in events)
    assert events[-1]["type"] == "run_finished"
    assert events[-1].get("status") == "failed"


def test_graph_ref_subprocess_cancel_while_nested(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("GC_GRAPH_REF_SUBPROCESS", "1")
    clear_graph_index_cache()
    child_id = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    parent_id = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
    slow_child = _chain_graph(
        child_id,
        "cs",
        "ct",
        "ce",
        mid_type="task",
        mid_data={
            "command": [sys.executable, "-c", "import time; time.sleep(120)"],
            "cwd": str(tmp_path),
            "retryCount": 0,
        },
    )
    _write(tmp_path, "child.json", slow_child)
    parent = _chain_graph(
        parent_id, "ps", "pref", "pe", mid_type="graph_ref", mid_data={"targetGraphId": child_id}
    )
    _write(tmp_path, "parent.json", parent)
    root_doc = GraphDocument.from_dict(parent)

    reg = RunSessionRegistry()
    run_ids: list[str] = []
    nested_enter = threading.Event()
    events: list[dict] = []

    def sink(ev: dict) -> None:
        events.append(ev)
        if ev.get("type") == "run_started":
            run_ids.append(str(ev["runId"]))
        if ev.get("type") == "nested_graph_enter":
            nested_enter.set()

    def work() -> None:
        GraphRunner(
            root_doc,
            sink=sink,
            host=RunHostContext(graphs_root=tmp_path, artifacts_base=tmp_path),
            session_registry=reg,
        ).run(context={"last_result": True})

    th = threading.Thread(target=work)
    th.start()
    assert nested_enter.wait(timeout=15.0)
    assert run_ids
    assert reg.request_cancel(run_ids[0])
    th.join(timeout=25.0)
    assert not th.is_alive()
    assert events[-1]["type"] == "run_finished"
    assert events[-1].get("status") == "cancelled"


def test_graph_ref_subprocess_merges_outputs_for_edge_condition(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("GC_GRAPH_REF_SUBPROCESS", "1")
    clear_graph_index_cache()
    child_id = "99999999-9999-4999-8999-999999999999"
    parent_id = "88888888-8888-4888-8888-888888888888"
    child = _chain_graph(
        child_id,
        "cs",
        "ct",
        "ce",
        mid_type="task",
        mid_data={
            "command": [sys.executable, "-c", "print(1)"],
            "cwd": str(tmp_path),
            "retryCount": 0,
        },
    )
    _write(tmp_path, "child.json", child)
    parent_doc = {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": parent_id, "title": "p"},
        "viewport": {"x": 0, "y": 0, "zoom": 1},
        "nodes": [
            {"id": "ps", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {
                "id": "pref",
                "type": "graph_ref",
                "position": {"x": 0, "y": 0},
                "data": {"targetGraphId": child_id},
            },
            {"id": "pe", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
        ],
        "edges": [
            {
                "id": "e1",
                "source": "ps",
                "sourceHandle": "out_default",
                "target": "pref",
                "targetHandle": "in_default",
                "condition": None,
            },
            {
                "id": "e2",
                "source": "pref",
                "sourceHandle": "out_default",
                "target": "pe",
                "targetHandle": "in_default",
                "condition": '{{ $node.ct.processResult.exitCode }} == 0',
            },
        ],
    }
    _write(tmp_path, "parent.json", parent_doc)
    root_doc = GraphDocument.from_dict(parent_doc)
    events: list[dict] = []
    GraphRunner(root_doc, sink=lambda e: events.append(e), host=RunHostContext(graphs_root=tmp_path)).run(
        context={"last_result": True}
    )
    assert events[-1].get("status") == "success"
    assert any(e.get("type") == "run_success" and e.get("nodeId") == "pe" for e in events)


def test_write_nested_context_json_propagates_nested_doc_revisions(tmp_path: Path) -> None:
    from graph_caster.nested_run_subprocess import write_nested_context_json

    gid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    rev64 = "ab" * 32
    ctx: dict = {
        "node_outputs": {},
        "nesting_depth": 1,
        "_gc_nested_doc_revisions": {gid: rev64},
    }
    out = tmp_path / "nested_ctx.json"
    write_nested_context_json(ctx, out)
    raw = json.loads(out.read_text(encoding="utf-8"))
    assert raw.get("_gc_nested_doc_revisions") == {gid: rev64}
