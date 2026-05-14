# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest

pytest.importorskip("starlette")

from starlette.testclient import TestClient

from graph_caster.run_broker.app import create_app
from graph_caster.run_broker.registry import RunBrokerRegistry
from graph_caster.run_broker.routes.api_v1 import (
    APIV1Handler,
    RunRequest,
)


class _TrackingRunManager:
    """Run manager that records start_run calls."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self._runs: dict[str, dict[str, Any]] = {}

    async def start_run(
        self,
        graph_id: str,
        context: dict[str, Any] | None = None,
        trigger_context: dict[str, Any] | None = None,
    ) -> str:
        run_id = f"run_{len(self.calls) + 1}"
        self.calls.append(
            {
                "graph_id": graph_id,
                "context": context,
                "trigger_context": trigger_context,
            }
        )
        self._runs[run_id] = {
            "run_id": run_id,
            "graph_id": graph_id,
            "status": "running",
            "created_at": "2026-05-12T00:00:00",
        }
        return run_id

    async def wait_for_run(self, run_id: str, timeout: float = 300.0) -> dict[str, Any]:
        return {"status": "completed", "outputs": {}}

    async def get_run_status(self, run_id: str) -> dict[str, Any] | None:
        return self._runs.get(run_id)

    async def cancel_run(self, run_id: str) -> dict[str, Any]:
        return {"cancelled": False, "message": "not implemented"}

    async def get_run_events_ndjson(self, run_id: str, max_bytes: int) -> tuple[str, bool] | None:
        if run_id not in self._runs:
            return None
        return "", False


def _minimal_doc(graph_id: str) -> dict:
    return {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": graph_id, "title": "t"},
        "viewport": {"x": 0, "y": 0, "zoom": 1},
        "nodes": [
            {"id": "s", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {"id": "t1", "type": "task", "position": {"x": 100, "y": 0}, "data": {}},
            {"id": "x", "type": "exit", "position": {"x": 200, "y": 0}, "data": {}},
        ],
        "edges": [
            {
                "id": "e1",
                "source": "s",
                "sourceHandle": "out_default",
                "target": "t1",
                "targetHandle": "in_default",
                "condition": None,
            },
            {
                "id": "e2",
                "source": "t1",
                "sourceHandle": "out_default",
                "target": "x",
                "targetHandle": "in_default",
                "condition": None,
            },
        ],
    }


class TestRunRequestSingleNodeFields:
    """Unit tests for RunRequest new optional fields."""

    def test_defaults_are_none(self) -> None:
        req = RunRequest()
        assert req.start_from_node is None
        assert req.until_node is None
        assert req.context is None

    def test_can_set_all_fields(self) -> None:
        req = RunRequest(
            inputs={"x": 1},
            start_from_node="node-abc",
            until_node="node-abc",
            context={"node_outputs": {"node-prev": {"result": "ok"}}},
        )
        assert req.start_from_node == "node-abc"
        assert req.until_node == "node-abc"
        assert req.context is not None
        assert req.context["node_outputs"]["node-prev"]["result"] == "ok"


class TestAPIV1HandlerSingleNode:
    """Tests for APIV1Handler with single-node run fields."""

    def test_start_run_passes_start_from_node_in_context(self) -> None:
        async def _run() -> None:
            mgr = _TrackingRunManager()
            handler = APIV1Handler(mgr)
            req = RunRequest(
                inputs={},
                start_from_node="node-42",
                until_node="node-42",
                context={"node_outputs": {"node-prev": {"out": "val"}}},
            )
            resp = await handler.start_run("graph-x", req)
            assert resp.run_id == "run_1"
            assert resp.status == "started"
            assert len(mgr.calls) == 1
            call = mgr.calls[0]
            ctx = call["context"]
            assert ctx is not None
            assert ctx.get("startFromNode") == "node-42"
            assert ctx.get("untilNode") == "node-42"
            assert ctx.get("node_outputs") == {"node-prev": {"out": "val"}}

        asyncio.run(_run())

    def test_start_run_without_single_node_fields_is_compat(self) -> None:
        async def _run() -> None:
            mgr = _TrackingRunManager()
            handler = APIV1Handler(mgr)
            req = RunRequest(inputs={"a": 1})
            resp = await handler.start_run("graph-y", req)
            assert resp.status == "started"
            call = mgr.calls[0]
            ctx = call["context"]
            assert "startFromNode" not in ctx
            assert "untilNode" not in ctx

        asyncio.run(_run())

    def test_start_run_with_start_from_and_until_reaches_manager(self) -> None:
        async def _run() -> None:
            mgr = _TrackingRunManager()
            handler = APIV1Handler(mgr)
            req = RunRequest(start_from_node="n1", until_node="n1")
            resp = await handler.start_run("graph-z", req)
            assert resp.status == "started"
            assert len(mgr.calls) == 1
            ctx = mgr.calls[0]["context"]
            assert ctx is not None
            assert ctx.get("startFromNode") == "n1"
            assert ctx.get("untilNode") == "n1"

        asyncio.run(_run())


class TestAPIV1HttpSingleNode:
    """HTTP-level tests for single-node run via the REST endpoint."""

    def test_post_run_with_single_node_fields_returns_200(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path
    ) -> None:
        gid = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
        graphs = tmp_path / "graphs"
        graphs.mkdir()
        art = tmp_path / "artifacts"
        art.mkdir()
        (graphs / "doc.json").write_text(
            json.dumps(_minimal_doc(gid)), encoding="utf-8"
        )
        monkeypatch.setenv("GC_RUN_BROKER_GRAPHS_DIR", str(graphs))
        monkeypatch.setenv("GC_RUN_BROKER_ARTIFACTS_BASE", str(art))
        monkeypatch.delenv("GC_RUN_BROKER_V1_API_KEYS", raising=False)

        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))

        body = {
            "inputs": {},
            "startFromNode": "t1",
            "untilNode": "t1",
            "context": {"node_outputs": {"s": {"result": "start-out"}}},
        }
        r = client.post(f"/api/v1/graphs/{gid}/run", json=body)
        assert r.status_code == 200, r.text
        j = r.json()
        assert "runId" in j
        assert j["graphId"] == gid
        assert j["status"] == "started"

    def test_post_run_without_single_node_fields_still_works(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path
    ) -> None:
        gid = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
        graphs = tmp_path / "graphs"
        graphs.mkdir()
        art = tmp_path / "artifacts"
        art.mkdir()
        (graphs / "doc.json").write_text(
            json.dumps(_minimal_doc(gid)), encoding="utf-8"
        )
        monkeypatch.setenv("GC_RUN_BROKER_GRAPHS_DIR", str(graphs))
        monkeypatch.setenv("GC_RUN_BROKER_ARTIFACTS_BASE", str(art))
        monkeypatch.delenv("GC_RUN_BROKER_V1_API_KEYS", raising=False)

        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))

        r = client.post(f"/api/v1/graphs/{gid}/run", json={"inputs": {}})
        assert r.status_code == 200, r.text
        assert "runId" in r.json()

    def test_post_run_context_must_be_object(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path
    ) -> None:
        gid = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
        graphs = tmp_path / "graphs"
        graphs.mkdir()
        (graphs / "doc.json").write_text(
            json.dumps(_minimal_doc(gid)), encoding="utf-8"
        )
        monkeypatch.setenv("GC_RUN_BROKER_GRAPHS_DIR", str(graphs))
        monkeypatch.delenv("GC_RUN_BROKER_V1_API_KEYS", raising=False)

        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))

        r = client.post(
            f"/api/v1/graphs/{gid}/run",
            json={"inputs": {}, "context": "not-an-object"},
        )
        assert r.status_code == 400
        assert "context" in r.json().get("error", "")

    def test_post_run_with_single_node_reaches_terminal_status(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path
    ) -> None:
        gid = "ffffffff-ffff-4fff-8fff-ffffffffffff"
        graphs = tmp_path / "graphs"
        graphs.mkdir()
        art = tmp_path / "artifacts"
        art.mkdir()
        (graphs / "doc.json").write_text(
            json.dumps(_minimal_doc(gid)), encoding="utf-8"
        )
        monkeypatch.setenv("GC_RUN_BROKER_GRAPHS_DIR", str(graphs))
        monkeypatch.setenv("GC_RUN_BROKER_ARTIFACTS_BASE", str(art))
        monkeypatch.delenv("GC_RUN_BROKER_V1_API_KEYS", raising=False)

        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))

        body = {
            "inputs": {},
            "startFromNode": "t1",
            "untilNode": "t1",
        }
        start = client.post(f"/api/v1/graphs/{gid}/run", json=body)
        assert start.status_code == 200, start.text
        rid = start.json()["runId"]

        status = None
        for _ in range(200):
            gr = client.get(f"/api/v1/runs/{rid}")
            assert gr.status_code == 200
            status = gr.json().get("status")
            if status in ("success", "failed", "cancelled", "partial"):
                break
        assert status is not None
        assert status in ("success", "failed", "cancelled", "partial")
