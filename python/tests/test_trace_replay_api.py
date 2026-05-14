# Copyright GraphCaster. All Rights Reserved.

"""Tests for F102 REST API replay endpoints."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any
from datetime import datetime, timezone

import pytest

pytest.importorskip("starlette")

from starlette.testclient import TestClient

from graph_caster.run_broker.auth.api_key import APIKeyAuthenticator
from graph_caster.run_broker.registry import RunBrokerRegistry
from graph_caster.run_broker.app import create_app
from graph_caster.run_broker.routes.api_v1 import APIV1Handler


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _write_events(run_dir: Path, events: list[dict]) -> None:
    (run_dir / "events.ndjson").write_text(
        "\n".join(json.dumps(e) for e in events) + "\n",
        encoding="utf-8",
    )


def _write_summary(run_dir: Path, run_id: str, graph_id: str) -> None:
    (run_dir / "run-summary.json").write_text(
        json.dumps({"runId": run_id, "graphId": graph_id, "status": "success"}),
        encoding="utf-8",
    )


def _make_graph_doc(graph_id: str) -> dict:
    return {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": graph_id, "title": "t"},
        "nodes": [
            {"id": "A", "type": "task", "position": {"x": 0, "y": 0}, "data": {}},
            {"id": "B", "type": "task", "position": {"x": 0, "y": 0}, "data": {}},
            {"id": "C", "type": "task", "position": {"x": 0, "y": 0}, "data": {}},
        ],
        "edges": [
            {
                "id": "e1",
                "source": "A",
                "sourceHandle": "out_default",
                "target": "B",
                "targetHandle": "in_default",
            },
            {
                "id": "e2",
                "source": "B",
                "sourceHandle": "out_default",
                "target": "C",
                "targetHandle": "in_default",
            },
        ],
    }


def _setup_workspace(
    tmp_path: Path,
    graph_id: str,
    run_id: str,
    monkeypatch: pytest.MonkeyPatch,
) -> Path:
    workspace = tmp_path / "ws"
    workspace.mkdir()
    graphs_dir = workspace / "graphs"
    graphs_dir.mkdir()
    (graphs_dir / "graph.json").write_text(
        json.dumps(_make_graph_doc(graph_id)), encoding="utf-8"
    )

    run_dir = workspace / "runs" / graph_id / "20260101T000000_test"
    run_dir.mkdir(parents=True)
    _write_events(
        run_dir,
        [
            {"type": "run_started", "runId": run_id, "timestamp": _iso()},
            {"type": "step_started", "runId": run_id, "nodeId": "A", "index": 0},
            {
                "type": "step_finished",
                "runId": run_id,
                "nodeId": "A",
                "ok": True,
                "output": {"r": 1},
                "index": 1,
            },
            {"type": "step_started", "runId": run_id, "nodeId": "B", "index": 2},
            {
                "type": "step_finished",
                "runId": run_id,
                "nodeId": "B",
                "ok": False,
                "output": None,
                "index": 3,
            },
        ],
    )
    _write_summary(run_dir, run_id, graph_id)

    monkeypatch.setenv("GC_RUN_BROKER_WORKSPACE_ROOT", str(workspace))
    monkeypatch.delenv("GC_RUN_BROKER_V1_API_KEYS", raising=False)
    monkeypatch.delenv("GC_RUN_BROKER_GRAPHS_DIR", raising=False)
    return workspace


# ---------------------------------------------------------------------------
# Unit tests for APIV1Handler.get_replay_plan / start_replay
# ---------------------------------------------------------------------------


class MockRunManager:
    """Minimal mock run manager."""

    async def start_run(self, graph_id: str, context=None, trigger_context=None) -> str:
        return "new-run-1"

    async def wait_for_run(self, run_id: str, timeout: float = 300.0) -> dict:
        return {"status": "completed", "outputs": {}}

    async def get_run_status(self, run_id: str) -> dict | None:
        return None

    async def cancel_run(self, run_id: str) -> dict:
        return {"cancelled": False}

    async def get_run_events_ndjson(self, run_id: str, max_bytes: int):
        return None


class TestAPIV1HandlerReplay:
    def test_get_replay_plan_returns_plan(self, tmp_path: Path) -> None:
        graph_id = "gr1"
        run_id = "rr1"
        workspace = tmp_path / "ws"
        workspace.mkdir()
        (workspace / "graphs").mkdir()
        (workspace / "graphs" / "g.json").write_text(
            json.dumps(_make_graph_doc(graph_id)), encoding="utf-8"
        )
        run_dir = workspace / "runs" / graph_id / "20260101T000000_t"
        run_dir.mkdir(parents=True)
        _write_events(
            run_dir,
            [
                {"type": "run_started", "runId": run_id, "timestamp": _iso()},
                {"type": "step_started", "runId": run_id, "nodeId": "A", "index": 0},
                {
                    "type": "step_finished",
                    "runId": run_id,
                    "nodeId": "A",
                    "ok": True,
                    "output": {"v": 5},
                    "index": 1,
                },
                {"type": "step_started", "runId": run_id, "nodeId": "B", "index": 2},
                {
                    "type": "step_finished",
                    "runId": run_id,
                    "nodeId": "B",
                    "ok": False,
                    "output": None,
                    "index": 3,
                },
            ],
        )
        _write_summary(run_dir, run_id, graph_id)

        async def go() -> dict:
            handler = APIV1Handler(MockRunManager())
            return await handler.get_replay_plan(run_id, workspace_root=workspace)

        plan = asyncio.run(go())
        assert plan["runId"] == run_id
        assert plan["startFromNode"] == "B"
        assert "A" in plan["skippedNodes"]
        assert "B" in plan["replayedNodes"]

    def test_get_replay_plan_raises_key_error_for_unknown_run(
        self, tmp_path: Path
    ) -> None:
        workspace = tmp_path / "ws"
        workspace.mkdir()
        (workspace / "graphs").mkdir()
        (workspace / "runs").mkdir()

        async def go() -> None:
            handler = APIV1Handler(MockRunManager())
            await handler.get_replay_plan("no-such-run", workspace_root=workspace)

        with pytest.raises(KeyError):
            asyncio.run(go())

    def test_get_replay_plan_enforces_auth_scope(self, tmp_path: Path) -> None:
        workspace = tmp_path / "ws"
        workspace.mkdir()
        (workspace / "graphs").mkdir()
        (workspace / "runs").mkdir()

        auth = APIKeyAuthenticator()
        auth.register_key("gc_ro", "secret", "readonly", ["run:view"])
        auth.register_key("gc_wr", "secret2", "writer", ["run:execute"])

        async def go(header: str) -> None:
            handler = APIV1Handler(MockRunManager(), auth=auth)
            await handler.get_replay_plan(
                "no-run", workspace_root=workspace, auth_header=header
            )

        # run:view should pass auth check (will fail on missing run later)
        with pytest.raises(KeyError):
            asyncio.run(go("Bearer gc_ro:secret"))

        # run:execute only (no run:view) should get PermissionError
        with pytest.raises(PermissionError, match="Missing scope: run:view"):
            asyncio.run(go("Bearer gc_wr:secret2"))

    def test_start_replay_enforces_auth_scope(self, tmp_path: Path) -> None:
        workspace = tmp_path / "ws"
        workspace.mkdir()
        (workspace / "graphs").mkdir()
        (workspace / "runs").mkdir()

        auth = APIKeyAuthenticator()
        auth.register_key("gc_view", "s", "viewer", ["run:view"])

        async def go() -> None:
            handler = APIV1Handler(MockRunManager(), auth=auth)
            await handler.start_replay(
                "no-run",
                workspace_root=workspace,
                auth_header="Bearer gc_view:s",
            )

        with pytest.raises(PermissionError, match="Missing scope: run:execute"):
            asyncio.run(go())


# ---------------------------------------------------------------------------
# HTTP integration tests (Starlette TestClient)
# ---------------------------------------------------------------------------


class TestReplayHTTPRoutes:
    def test_get_replay_plan_returns_plan_json(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        graph_id = "g-http-1"
        run_id = "r-http-1"
        workspace = _setup_workspace(tmp_path, graph_id, run_id, monkeypatch)

        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        r = client.get(f"/api/v1/runs/{run_id}/replay-plan")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["runId"] == run_id
        assert body["startFromNode"] == "B"
        assert "A" in body["skippedNodes"]

    def test_get_replay_plan_with_start_from_query(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        graph_id = "g-http-2"
        run_id = "r-http-2"
        _setup_workspace(tmp_path, graph_id, run_id, monkeypatch)

        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        r = client.get(f"/api/v1/runs/{run_id}/replay-plan?startFrom=B")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["startFromNode"] == "B"

    def test_get_replay_plan_404_unknown_run(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        workspace = tmp_path / "ws"
        workspace.mkdir()
        (workspace / "graphs").mkdir()
        (workspace / "runs").mkdir()
        monkeypatch.setenv("GC_RUN_BROKER_WORKSPACE_ROOT", str(workspace))
        monkeypatch.delenv("GC_RUN_BROKER_V1_API_KEYS", raising=False)

        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        r = client.get("/api/v1/runs/does-not-exist/replay-plan")
        assert r.status_code == 404

    def test_get_replay_plan_503_no_workspace(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("GC_RUN_BROKER_WORKSPACE_ROOT", raising=False)
        monkeypatch.delenv("GC_RUN_BROKER_ARTIFACTS_BASE", raising=False)
        monkeypatch.delenv("GC_RUN_BROKER_V1_API_KEYS", raising=False)

        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        r = client.get("/api/v1/runs/any/replay-plan")
        assert r.status_code == 503

    def test_post_replay_503_no_workspace(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("GC_RUN_BROKER_WORKSPACE_ROOT", raising=False)
        monkeypatch.delenv("GC_RUN_BROKER_ARTIFACTS_BASE", raising=False)
        monkeypatch.delenv("GC_RUN_BROKER_V1_API_KEYS", raising=False)

        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        r = client.post("/api/v1/runs/any/replay", json={})
        assert r.status_code == 503

    def test_post_replay_returns_new_run_id(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        graph_id = "g-exec-http"
        run_id = "r-exec-http"
        workspace = _setup_workspace(tmp_path, graph_id, run_id, monkeypatch)

        # Patch ReplayManager to avoid actually running the graph
        import graph_caster.run_broker.routes.api_v1 as _api_mod
        import graph_caster.replay as _replay_mod

        orig_mgr = _replay_mod.ReplayManager

        class PatchedManager:
            def __init__(self, ws: Path, **kwargs: Any) -> None:
                self._ws = ws

            async def build_plan(self, rid: str, **kwargs: Any) -> "ReplayPlan":
                from graph_caster.replay import ReplayPlan

                return ReplayPlan(
                    run_id=rid,
                    graph_id=graph_id,
                    graph_version=None,
                    start_from_node="B",
                    pinned_outputs={"A": {"r": 1}},
                    replayed_nodes=["B", "C"],
                    skipped_nodes=["A"],
                )

            async def execute(self, plan: Any, **kwargs: Any) -> str:
                return "new-replayed-run-id"

        monkeypatch.setattr(_replay_mod, "ReplayManager", PatchedManager)

        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        r = client.post(f"/api/v1/runs/{run_id}/replay", json={})
        assert r.status_code == 200, r.text
        body = r.json()
        assert "newRunId" in body
        assert body["replayOf"] == run_id

        monkeypatch.setattr(_replay_mod, "ReplayManager", orig_mgr)

    def test_post_replay_with_api_key_auth(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        graph_id = "g-auth-replay"
        run_id = "r-auth-replay"
        _setup_workspace(tmp_path, graph_id, run_id, monkeypatch)
        monkeypatch.setenv("GC_RUN_BROKER_V1_API_KEYS", "gc_key:mysecret")

        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))

        # Without auth key → 401
        r0 = client.post(f"/api/v1/runs/{run_id}/replay", json={})
        assert r0.status_code == 401

        # With wrong key → 401
        r1 = client.post(
            f"/api/v1/runs/{run_id}/replay",
            json={},
            headers={"Authorization": "Bearer gc_key:wrong"},
        )
        assert r1.status_code == 401
