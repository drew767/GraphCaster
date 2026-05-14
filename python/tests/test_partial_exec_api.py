# Copyright GraphCaster. All Rights Reserved.

"""Tests for F48 run-partial REST API endpoint."""

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest

pytest.importorskip("starlette")

from starlette.testclient import TestClient

from graph_caster.run_broker.routes.api_v1 import (
    APIV1Handler,
    RunResponse,
)
from graph_caster.run_broker.auth.api_key import APIKeyAuthenticator


# ---------------------------------------------------------------------------
# Mock run manager
# ---------------------------------------------------------------------------


class MockRunManager:
    def __init__(self) -> None:
        self.runs: dict[str, dict[str, Any]] = {}
        self.start_run_called: list[dict[str, Any]] = []

    async def start_run(
        self,
        graph_id: str,
        context: dict[str, Any] | None = None,
        trigger_context: dict[str, Any] | None = None,
    ) -> str:
        run_id = f"run_{len(self.runs) + 1}"
        self.start_run_called.append(
            {"graph_id": graph_id, "context": context, "trigger_context": trigger_context}
        )
        self.runs[run_id] = {
            "run_id": run_id,
            "graph_id": graph_id,
            "status": "running",
            "created_at": "2026-05-12T00:00:00Z",
        }
        return run_id

    async def wait_for_run(self, run_id: str, timeout: float = 300.0) -> dict[str, Any]:
        return {"status": "completed", "outputs": {}}

    async def get_run_status(self, run_id: str) -> dict[str, Any] | None:
        return self.runs.get(run_id)

    async def cancel_run(self, run_id: str) -> dict[str, Any]:
        return {"cancelled": True}

    async def get_run_events_ndjson(self, run_id: str, max_bytes: int) -> tuple[str, bool] | None:
        if run_id not in self.runs:
            return None
        return "", False


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_handler_with_auth(scopes: list[str] | None = None) -> tuple[APIV1Handler, str]:
    """Return (handler, bearer_token) with a registered API key."""
    auth = APIKeyAuthenticator()
    auth.register_key("gc_test", "secret", "test-key", scopes or ["run:execute", "run:view"])
    mgr = MockRunManager()
    handler = APIV1Handler(mgr, auth=auth)
    token = "Bearer gc_test:secret"
    return handler, token


def _make_handler_no_auth() -> APIV1Handler:
    mgr = MockRunManager()
    return APIV1Handler(mgr, auth=None)


# ---------------------------------------------------------------------------
# Tests for APIV1Handler.start_partial_run
# ---------------------------------------------------------------------------


class TestStartPartialRunHandler:
    def test_start_partial_run_returns_run_id(self, tmp_path) -> None:
        """POST run-partial with valid body starts a run and returns runId."""

        async def run() -> None:
            handler = _make_handler_no_auth()
            resp = await handler.start_partial_run(
                "my-graph",
                start_node="node-D",
                use_pins=False,
                workspace_root=tmp_path,
            )
            assert isinstance(resp, RunResponse)
            assert resp.run_id == "run_1"
            assert resp.graph_id == "my-graph"
            assert resp.status == "started"

        asyncio.run(run())

    def test_start_partial_run_requires_run_execute_scope(self, tmp_path) -> None:
        """Missing scope raises PermissionError."""

        async def run() -> None:
            auth = APIKeyAuthenticator()
            auth.register_key("gc_view", "s", "viewer", ["run:view"])
            mgr = MockRunManager()
            handler = APIV1Handler(mgr, auth=auth)
            with pytest.raises(PermissionError):
                await handler.start_partial_run(
                    "my-graph",
                    start_node="node-D",
                    workspace_root=tmp_path,
                    auth_header="Bearer gc_view:s",
                )

        asyncio.run(run())

    def test_start_partial_run_wrong_key_raises(self, tmp_path) -> None:
        """Invalid API key raises PermissionError."""

        async def run() -> None:
            handler, _ = _make_handler_with_auth()
            with pytest.raises(PermissionError):
                await handler.start_partial_run(
                    "my-graph",
                    start_node="node-D",
                    workspace_root=tmp_path,
                    auth_header="Bearer gc_bad:wrong",
                )

        asyncio.run(run())

    def test_start_partial_run_no_graph_doc_still_starts(self, tmp_path) -> None:
        """When no graph document is found, run still starts (no ancestor pinning)."""

        async def run() -> None:
            handler = _make_handler_no_auth()
            # No graphs/ dir → partial_exec skips building pinned context
            resp = await handler.start_partial_run(
                "missing-graph",
                start_node="some-node",
                use_pins=True,
                workspace_root=tmp_path,
            )
            assert resp.status == "started"

        asyncio.run(run())

    def test_start_partial_run_passes_start_node_in_context(self, tmp_path) -> None:
        """The startFromNode key is passed in the run context."""

        async def run() -> None:
            mgr = MockRunManager()
            handler = APIV1Handler(mgr, auth=None)
            await handler.start_partial_run(
                "g1",
                start_node="node-X",
                workspace_root=tmp_path,
            )
            assert len(mgr.start_run_called) == 1
            ctx = mgr.start_run_called[0]["context"]
            assert ctx["startFromNode"] == "node-X"

        asyncio.run(run())


# ---------------------------------------------------------------------------
# HTTP-layer tests via starlette TestClient
# ---------------------------------------------------------------------------


def _make_app_with_handler(handler: APIV1Handler) -> "Any":
    """Build a minimal Starlette app with the run-partial route only."""
    import os
    from pathlib import Path
    from starlette.applications import Starlette
    from starlette.requests import Request
    from starlette.responses import JSONResponse, Response
    from starlette.routing import Route

    async def post_run_partial(request: Request) -> Response:
        graph_id = request.path_params["graph_id"]
        auth_h = request.headers.get("Authorization")

        if handler._auth is not None:
            key = handler._auth.validate(auth_h)
            if key is None:
                return JSONResponse({"error": "Invalid API key"}, status_code=403)
            if not handler._auth.has_scope(key, "run:execute"):
                return JSONResponse({"error": "Missing scope: run:execute"}, status_code=403)

        try:
            body = await request.json()
        except Exception:
            return JSONResponse({"error": "invalid JSON body"}, status_code=400)

        start_node = (body.get("startNode") or "").strip()
        if not start_node:
            return JSONResponse({"error": "startNode is required"}, status_code=400)

        try:
            resp = await handler.start_partial_run(
                graph_id,
                start_node=start_node,
                use_pins=bool(body.get("usePins", True)),
                from_run_id=body.get("fromRunId") or None,
                overrides=body.get("overrides") or None,
                auth_header=auth_h,
            )
        except PermissionError as exc:
            return JSONResponse({"error": str(exc)}, status_code=403)

        return JSONResponse(
            {
                "runId": resp.run_id,
                "graphId": resp.graph_id,
                "status": resp.status,
                "startNode": start_node,
            }
        )

    app = Starlette(
        routes=[
            Route(
                "/api/v1/graphs/{graph_id}/run-partial",
                post_run_partial,
                methods=["POST"],
            )
        ]
    )
    return app


class TestRunPartialHTTP:
    def test_post_run_partial_valid_body_returns_200(self) -> None:
        """POST /run-partial with valid body returns 200 and runId."""
        handler = _make_handler_no_auth()
        app = _make_app_with_handler(handler)
        client = TestClient(app)

        resp = client.post(
            "/api/v1/graphs/my-graph/run-partial",
            json={"startNode": "n3", "usePins": True},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "runId" in body
        assert body["graphId"] == "my-graph"
        assert body["startNode"] == "n3"
        assert body["status"] == "started"

    def test_post_run_partial_missing_start_node_returns_400(self) -> None:
        """POST /run-partial without startNode returns 400."""
        handler = _make_handler_no_auth()
        app = _make_app_with_handler(handler)
        client = TestClient(app)

        resp = client.post(
            "/api/v1/graphs/my-graph/run-partial",
            json={"usePins": True},
        )
        assert resp.status_code == 400

    def test_post_run_partial_invalid_api_key_returns_403(self) -> None:
        """POST /run-partial without valid scope returns 403."""
        auth = APIKeyAuthenticator()
        auth.register_key("gc_view", "s", "viewer", ["run:view"])
        mgr = MockRunManager()
        handler = APIV1Handler(mgr, auth=auth)
        app = _make_app_with_handler(handler)
        client = TestClient(app)

        resp = client.post(
            "/api/v1/graphs/my-graph/run-partial",
            json={"startNode": "n3"},
            headers={"Authorization": "Bearer gc_view:s"},
        )
        assert resp.status_code == 403
        assert "scope" in resp.json()["error"]

    def test_post_run_partial_no_auth_configured_allows_request(self) -> None:
        """Without auth configured, any request is allowed."""
        handler = _make_handler_no_auth()
        app = _make_app_with_handler(handler)
        client = TestClient(app)

        resp = client.post(
            "/api/v1/graphs/g1/run-partial",
            json={"startNode": "start"},
        )
        assert resp.status_code == 200

    def test_post_run_partial_with_overrides(self) -> None:
        """Overrides dict is forwarded to start_partial_run."""
        mgr = MockRunManager()
        handler = APIV1Handler(mgr, auth=None)
        app = _make_app_with_handler(handler)
        client = TestClient(app)

        payload = {
            "startNode": "n3",
            "usePins": True,
            "fromRunId": "r-1234",
            "overrides": {"n1": {"out_default": {"x": 99}}},
        }
        resp = client.post("/api/v1/graphs/g1/run-partial", json=payload)
        assert resp.status_code == 200
        assert resp.json()["runId"] == "run_1"
