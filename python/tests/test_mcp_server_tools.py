# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import asyncio
import json
import uuid
from concurrent.futures import TimeoutError as FuturesTimeoutError
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from graph_caster.host_context import RunHostContext
from graph_caster.mcp_server.handlers import (
    cancel_run_handler,
    list_graphs_handler,
    run_graph_handler,
)
from graph_caster.run_sessions import RunSession, get_default_run_registry, reset_default_run_registry


def _minimal_linear_graph_json(gid: str) -> str:
    doc = {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": gid, "title": "mcp-test"},
        "nodes": [
            {"id": "s0", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {"id": "x0", "type": "exit", "position": {"x": 1, "y": 0}, "data": {}},
        ],
        "edges": [
            {
                "id": "e0",
                "source": "s0",
                "sourceHandle": "out_default",
                "target": "x0",
                "targetHandle": "in_default",
            }
        ],
    }
    return json.dumps(doc, indent=2)


def test_list_graphs_requires_graphs_root() -> None:
    host = RunHostContext(graphs_root=None)
    r = list_graphs_handler(host)
    assert r["ok"] is False


def test_list_graphs_ok(tmp_path: Path) -> None:
    gdir = tmp_path / "graphs"
    gdir.mkdir()
    (gdir / "a.json").write_text(_minimal_linear_graph_json("11111111-1111-4111-8111-111111111111"), encoding="utf-8")
    host = RunHostContext(graphs_root=gdir)
    r = list_graphs_handler(host, limit=10, include_titles=True)
    assert r["ok"] is True
    assert r["count"] == 1
    assert r["graphs"][0]["graphId"] == "11111111-1111-4111-8111-111111111111"
    assert r["graphs"][0]["title"] == "mcp-test"


def test_run_graph_dry_run(tmp_path: Path) -> None:
    gdir = tmp_path / "graphs"
    gdir.mkdir()
    (gdir / "flow.json").write_text(_minimal_linear_graph_json("22222222-2222-4222-8222-222222222222"), encoding="utf-8")
    host = RunHostContext(graphs_root=gdir)
    r = run_graph_handler(host, relative_path="flow.json", dry_run_validate_only=True)
    assert r["ok"] is True
    assert r["dryRun"] is True
    assert r["nodeCount"] == 2


def test_run_graph_full_success(tmp_path: Path) -> None:
    gdir = tmp_path / "graphs"
    gdir.mkdir()
    (gdir / "ok.json").write_text(_minimal_linear_graph_json("33333333-3333-4333-8333-333333333333"), encoding="utf-8")
    host = RunHostContext(graphs_root=gdir)
    r = run_graph_handler(host, graph_id="33333333-3333-4333-8333-333333333333", timeout_sec=30.0)
    assert r["ok"] is True
    assert r["status"] == "success"
    assert "runId" in r
    assert any(b.get("type") == "run_finished" for b in r.get("eventBriefs", []))


def test_run_graph_exclusive_args(tmp_path: Path) -> None:
    gdir = tmp_path / "graphs"
    gdir.mkdir()
    host = RunHostContext(graphs_root=gdir)
    r = run_graph_handler(host, graph_id="x", relative_path="y.json")
    assert r["ok"] is False


def test_run_graph_unknown_id(tmp_path: Path) -> None:
    gdir = tmp_path / "graphs"
    gdir.mkdir()
    host = RunHostContext(graphs_root=gdir)
    r = run_graph_handler(host, graph_id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
    assert r["ok"] is False


def test_run_graph_path_traversal_rejected(tmp_path: Path) -> None:
    gdir = tmp_path / "graphs"
    gdir.mkdir()
    host = RunHostContext(graphs_root=gdir)
    r = run_graph_handler(host, relative_path="../secrets.json")
    assert r["ok"] is False


def test_cancel_run_requires_run_id() -> None:
    reset_default_run_registry()
    try:
        r = cancel_run_handler("")
        assert r["ok"] is False
        assert r["error"] == "runId is required"
    finally:
        reset_default_run_registry()


def test_cancel_run_invalid_uuid() -> None:
    reset_default_run_registry()
    try:
        r = cancel_run_handler("not-a-uuid")
        assert r["ok"] is False
        assert "uuid" in r["error"].lower()
    finally:
        reset_default_run_registry()


def test_cancel_run_unknown_id() -> None:
    reset_default_run_registry()
    try:
        rid = str(uuid.uuid4())
        r = cancel_run_handler(rid)
        assert r["ok"] is True
        assert r["cancelRequested"] is False
        assert r["reason"] == "unknown_run_id"
        assert r["runId"] == rid
    finally:
        reset_default_run_registry()


def test_cancel_run_not_active_after_complete() -> None:
    reset_default_run_registry()
    try:
        rid = str(uuid.uuid4())
        gid = "11111111-1111-4111-8111-111111111111"
        reg = get_default_run_registry()
        reg.register(RunSession(run_id=rid, root_graph_id=gid))
        reg.complete(rid, "success")
        r = cancel_run_handler(rid)
        assert r["ok"] is True
        assert r["cancelRequested"] is False
        assert r["reason"] == "run_not_active"
    finally:
        reset_default_run_registry()


def test_cancel_run_sets_event_for_running_session() -> None:
    reset_default_run_registry()
    try:
        rid = str(uuid.uuid4())
        gid = "22222222-2222-4222-8222-222222222222"
        session = RunSession(run_id=rid, root_graph_id=gid)
        get_default_run_registry().register(session)
        r = cancel_run_handler(rid)
        assert r["ok"] is True
        assert r["cancelRequested"] is True
        assert r["runId"] == rid
        assert session.cancel_event.is_set()
    finally:
        reset_default_run_registry()


def test_build_fastmcp_smoke(tmp_path: Path) -> None:
    pytest.importorskip("mcp")
    from graph_caster.mcp_server.server import build_fastmcp

    gdir = tmp_path / "g"
    gdir.mkdir()
    app = build_fastmcp(RunHostContext(graphs_root=gdir))
    assert app.name == "GraphCaster"

    tools = asyncio.run(app.list_tools())
    names = {t.name for t in tools}
    assert names == {"graphcaster_list_graphs", "graphcaster_run_graph", "graphcaster_cancel_run"}
    cancel = next(t for t in tools if t.name == "graphcaster_cancel_run")
    assert cancel.inputSchema.get("required") == ["run_id"]


def test_list_graphs_workspace_index_error(tmp_path: Path) -> None:
    gdir = tmp_path / "graphs"
    gdir.mkdir()
    (gdir / "bad.json").write_text("{ not json", encoding="utf-8")
    host = RunHostContext(graphs_root=gdir)
    r = list_graphs_handler(host)
    assert r["ok"] is False
    assert "error" in r


def _graph_with_ref(gid: str, target: str) -> str:
    doc = {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": gid, "title": "ref"},
        "nodes": [
            {"id": "s0", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {
                "id": "r0",
                "type": "graph_ref",
                "position": {"x": 1, "y": 0},
                "data": {"targetGraphId": target},
            },
            {"id": "x0", "type": "exit", "position": {"x": 2, "y": 0}, "data": {}},
        ],
        "edges": [
            {
                "id": "e0",
                "source": "s0",
                "sourceHandle": "out_default",
                "target": "r0",
                "targetHandle": "in_default",
            },
            {
                "id": "e1",
                "source": "r0",
                "sourceHandle": "out_default",
                "target": "x0",
                "targetHandle": "in_default",
            },
        ],
    }
    return json.dumps(doc, indent=2)


def test_run_graph_ref_cycle_rejected(tmp_path: Path) -> None:
    gid_a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    gid_b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    gdir = tmp_path / "graphs"
    gdir.mkdir()
    (gdir / "a.json").write_text(_graph_with_ref(gid_a, gid_b), encoding="utf-8")
    (gdir / "b.json").write_text(_graph_with_ref(gid_b, gid_a), encoding="utf-8")
    host = RunHostContext(graphs_root=gdir)
    r = run_graph_handler(host, relative_path="a.json", dry_run_validate_only=True)
    assert r["ok"] is False
    assert "cycle" in r["error"].lower()


def test_run_graph_structure_error_two_starts(tmp_path: Path) -> None:
    gid = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    doc = {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": gid, "title": "bad"},
        "nodes": [
            {"id": "s1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {"id": "s2", "type": "start", "position": {"x": 1, "y": 0}, "data": {}},
            {"id": "x0", "type": "exit", "position": {"x": 2, "y": 0}, "data": {}},
        ],
        "edges": [],
    }
    gdir = tmp_path / "graphs"
    gdir.mkdir()
    (gdir / "two-starts.json").write_text(json.dumps(doc), encoding="utf-8")
    host = RunHostContext(graphs_root=gdir)
    r = run_graph_handler(host, relative_path="two-starts.json", dry_run_validate_only=True)
    assert r["ok"] is False


def test_run_graph_timeout_requests_cancel_then_stuck(tmp_path: Path) -> None:
    gdir = tmp_path / "graphs"
    gdir.mkdir()
    (gdir / "flow.json").write_text(
        _minimal_linear_graph_json("dddddddd-dddd-4ddd-8ddd-dddddddddddd"),
        encoding="utf-8",
    )
    host = RunHostContext(graphs_root=gdir)

    mock_fut = MagicMock()
    mock_fut.result.side_effect = [FuturesTimeoutError(), FuturesTimeoutError()]

    reg = get_default_run_registry()
    with patch.object(reg, "request_cancel", wraps=reg.request_cancel) as rq:
        with patch("graph_caster.mcp_server.handlers.ThreadPoolExecutor") as MockTPE:
            inst = MagicMock()
            mock_cm = MagicMock()
            mock_cm.__enter__ = MagicMock(return_value=inst)
            mock_cm.__exit__ = MagicMock(return_value=None)
            MockTPE.return_value = mock_cm
            inst.submit.return_value = mock_fut

            r = run_graph_handler(host, relative_path="flow.json", timeout_sec=5.0)

    assert r["ok"] is False
    assert r.get("workerStillRunning") is True
    assert "cooperative cancel" in r["error"].lower()
    rq.assert_called_once()
    assert rq.call_args[0][0] == r["runId"]
