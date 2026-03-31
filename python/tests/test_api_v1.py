# Copyright Aura. All Rights Reserved.

from __future__ import annotations

import asyncio
import json
from typing import Any

import pytest

pytest.importorskip("starlette")

from starlette.testclient import TestClient

from graph_caster.run_broker.app import create_app
from graph_caster.run_broker.auth.api_key import APIKey, APIKeyAuthenticator
from graph_caster.run_broker.registry import RunBrokerRegistry
from graph_caster.run_broker.routes.api_v1 import (
    APIV1Handler,
    CancelResponse,
    RunRequest,
    RunResponse,
)
from graph_caster.run_broker.routes.api_v1_openapi import (
    GC_API_V1_OPENAPI_DOCUMENT_VERSION,
    build_api_v1_openapi_document,
)


class TestAPIKeyAuthenticator:
    """Tests for APIKeyAuthenticator."""

    def test_register_key_and_validate_works(self) -> None:
        """Test that register_key and validate work correctly."""
        auth = APIKeyAuthenticator()
        key_id = "gc_test123"
        secret = "supersecret"
        auth.register_key(key_id, secret, "test-key", ["run:execute", "run:view"])

        # Valid auth header
        result = auth.validate(f"Bearer {key_id}:{secret}")
        assert result is not None
        assert result.key_id == key_id
        assert result.name == "test-key"
        assert result.scopes == ["run:execute", "run:view"]

    def test_validate_rejects_missing_header(self) -> None:
        """Test that validate rejects None header."""
        auth = APIKeyAuthenticator()
        assert auth.validate(None) is None

    def test_validate_rejects_non_bearer(self) -> None:
        """Test that validate rejects non-Bearer header."""
        auth = APIKeyAuthenticator()
        auth.register_key("gc_test", "secret", "test", ["*"])
        assert auth.validate("Basic gc_test:secret") is None

    def test_validate_rejects_malformed_token(self) -> None:
        """Test that validate rejects token without colon separator."""
        auth = APIKeyAuthenticator()
        auth.register_key("gc_test", "secret", "test", ["*"])
        assert auth.validate("Bearer gc_testsecret") is None

    def test_validate_rejects_unknown_key_id(self) -> None:
        """Test that validate rejects unknown key_id."""
        auth = APIKeyAuthenticator()
        auth.register_key("gc_real", "secret", "test", ["*"])
        assert auth.validate("Bearer gc_fake:secret") is None

    def test_validate_rejects_wrong_secret(self) -> None:
        """Test that validate rejects wrong secret."""
        auth = APIKeyAuthenticator()
        auth.register_key("gc_test", "correct_secret", "test", ["*"])
        assert auth.validate("Bearer gc_test:wrong_secret") is None

    def test_validate_rejects_disabled_key(self) -> None:
        """Test that validate rejects disabled keys."""
        auth = APIKeyAuthenticator()
        auth.register_key("gc_test", "secret", "test", ["*"])

        # Should work before disable
        assert auth.validate("Bearer gc_test:secret") is not None

        # Disable and verify rejection
        auth.disable_key("gc_test")
        assert auth.validate("Bearer gc_test:secret") is None

        # Re-enable and verify works again
        auth.enable_key("gc_test")
        assert auth.validate("Bearer gc_test:secret") is not None

    def test_has_scope_with_wildcard(self) -> None:
        """Test that wildcard scope grants all permissions."""
        auth = APIKeyAuthenticator()
        key = APIKey(
            key_id="gc_test", key_hash="x", name="test", scopes=["*"], enabled=True
        )
        assert auth.has_scope(key, "run:execute") is True
        assert auth.has_scope(key, "run:view") is True
        assert auth.has_scope(key, "run:cancel") is True
        assert auth.has_scope(key, "any:scope") is True

    def test_has_scope_with_specific_scopes(self) -> None:
        """Test that specific scopes are checked correctly."""
        auth = APIKeyAuthenticator()
        key = APIKey(
            key_id="gc_test",
            key_hash="x",
            name="test",
            scopes=["run:execute", "run:view"],
            enabled=True,
        )
        assert auth.has_scope(key, "run:execute") is True
        assert auth.has_scope(key, "run:view") is True
        assert auth.has_scope(key, "run:cancel") is False
        assert auth.has_scope(key, "admin:manage") is False

    def test_generate_key_format(self) -> None:
        """Test that generate_key produces valid format."""
        key_id, secret = APIKeyAuthenticator.generate_key()
        assert key_id.startswith("gc_")
        assert len(key_id) > 10
        assert len(secret) >= 32


class MockRunManager:
    """Mock run manager for testing APIV1Handler."""

    def __init__(self) -> None:
        self.runs: dict[str, dict[str, Any]] = {}
        self.start_run_called: list[dict[str, Any]] = []
        self.events_ndjson: dict[str, tuple[str, bool]] = {}

    async def start_run(
        self,
        graph_id: str,
        context: dict[str, Any] | None = None,
        trigger_context: dict[str, Any] | None = None,
    ) -> str:
        run_id = f"run_{len(self.runs) + 1}"
        self.start_run_called.append(
            {
                "graph_id": graph_id,
                "context": context,
                "trigger_context": trigger_context,
            }
        )
        self.runs[run_id] = {
            "run_id": run_id,
            "graph_id": graph_id,
            "status": "running",
            "created_at": "2026-03-31T12:00:00",
            "context": context,
        }
        return run_id

    async def wait_for_run(
        self, run_id: str, timeout: float = 300.0
    ) -> dict[str, Any]:
        run = self.runs.get(run_id)
        if run is None:
            return {"status": "not_found", "error": "Run not found"}
        return {
            "status": "completed",
            "outputs": {"result": "success"},
        }

    async def get_run_status(self, run_id: str) -> dict[str, Any] | None:
        return self.runs.get(run_id)

    async def cancel_run(self, run_id: str) -> dict[str, Any]:
        run = self.runs.get(run_id)
        if run is None:
            return {"cancelled": False, "message": "Run not found"}
        run["status"] = "cancelled"
        return {"cancelled": True, "message": "Run cancelled"}

    async def get_run_events_ndjson(
        self, run_id: str, max_bytes: int
    ) -> tuple[str, bool] | None:
        if run_id not in self.runs:
            return None
        text, truncated = self.events_ndjson.get(run_id, ("", False))
        data = text.encode("utf-8")
        if len(data) <= max_bytes:
            return text, truncated
        return data[-max_bytes:].decode("utf-8", errors="replace"), True


class TestAPIV1Handler:
    """Tests for APIV1Handler."""

    def test_start_run_creates_run_with_trigger_context(self) -> None:
        """Test that start_run passes correct trigger context."""

        async def run_test() -> None:
            manager = MockRunManager()
            handler = APIV1Handler(manager)

            request = RunRequest(inputs={"key": "value"})
            response = await handler.start_run("graph-123", request)

            assert response.run_id == "run_1"
            assert response.graph_id == "graph-123"
            assert response.status == "started"
            assert len(manager.start_run_called) == 1

            call = manager.start_run_called[0]
            assert call["graph_id"] == "graph-123"
            assert call["context"] == {"key": "value"}
            assert call["trigger_context"]["type"] == "api"
            assert call["trigger_context"]["graph_id"] == "graph-123"
            assert call["trigger_context"]["inputs"] == {"key": "value"}

        asyncio.run(run_test())

    def test_start_run_with_wait_for_completion(self) -> None:
        """Test that start_run waits when wait_for_completion is True."""

        async def run_test() -> None:
            manager = MockRunManager()
            handler = APIV1Handler(manager)

            request = RunRequest(wait_for_completion=True, timeout=60.0)
            response = await handler.start_run("graph-123", request)

            assert response.run_id == "run_1"
            assert response.status == "completed"
            assert response.outputs == {"result": "success"}

        asyncio.run(run_test())

    def test_get_run_status_returns_correct_format(self) -> None:
        """Test that get_run_status returns correctly formatted response."""

        async def run_test() -> None:
            manager = MockRunManager()
            handler = APIV1Handler(manager)

            # First create a run
            await handler.start_run("graph-123", RunRequest())

            # Then get status
            response = await handler.get_run_status("run_1")

            assert isinstance(response, RunResponse)
            assert response.run_id == "run_1"
            assert response.graph_id == "graph-123"
            assert response.status == "running"

        asyncio.run(run_test())

    def test_get_run_status_raises_on_not_found(self) -> None:
        """Test that get_run_status raises KeyError for unknown run."""

        async def run_test() -> None:
            manager = MockRunManager()
            handler = APIV1Handler(manager)

            with pytest.raises(KeyError, match="Run not found"):
                await handler.get_run_status("nonexistent")

        asyncio.run(run_test())

    def test_get_run_events_raises_on_not_found(self) -> None:
        """Test that get_run_events raises KeyError for unknown run."""

        async def run_test() -> None:
            manager = MockRunManager()
            handler = APIV1Handler(manager)

            with pytest.raises(KeyError, match="Run not found"):
                await handler.get_run_events("nonexistent", max_bytes=1000)

        asyncio.run(run_test())

    def test_get_run_events_returns_persisted_text(self) -> None:
        """Test get_run_events returns NDJSON from the run manager."""

        async def run_test() -> None:
            manager = MockRunManager()
            handler = APIV1Handler(manager)
            await handler.start_run("graph-123", RunRequest())
            line = '{"type":"run_started","runId":"run_1"}\n'
            manager.events_ndjson["run_1"] = (line, False)
            text, trunc = await handler.get_run_events("run_1", max_bytes=10_000)
            assert text == line
            assert trunc is False

        asyncio.run(run_test())

    def test_cancel_run_returns_correct_format(self) -> None:
        """Test that cancel_run returns correctly formatted response."""

        async def run_test() -> None:
            manager = MockRunManager()
            handler = APIV1Handler(manager)

            # First create a run
            await handler.start_run("graph-123", RunRequest())

            # Then cancel it
            response = await handler.cancel_run("run_1")

            assert isinstance(response, CancelResponse)
            assert response.run_id == "run_1"
            assert response.cancelled is True
            assert response.message == "Run cancelled"

        asyncio.run(run_test())

    def test_check_auth_enforces_scopes(self) -> None:
        """Test that _check_auth enforces required scopes."""

        async def run_test() -> None:
            auth = APIKeyAuthenticator()
            auth.register_key("gc_test", "secret", "test", ["run:view"])

            manager = MockRunManager()
            handler = APIV1Handler(manager, auth=auth)

            # First create a run without auth (to have data)
            manager.runs["run_1"] = {
                "run_id": "run_1",
                "graph_id": "graph-123",
                "status": "running",
                "created_at": "2026-03-31T12:00:00",
            }

            # Should work with valid key and matching scope
            response = await handler.get_run_status(
                "run_1",
                auth_header="Bearer gc_test:secret",
            )
            assert response.run_id == "run_1"

        asyncio.run(run_test())

    def test_check_auth_rejects_invalid_key(self) -> None:
        """Test that _check_auth rejects invalid key."""

        async def run_test() -> None:
            auth = APIKeyAuthenticator()
            auth.register_key("gc_test", "secret", "test", ["run:view"])

            manager = MockRunManager()
            handler = APIV1Handler(manager, auth=auth)

            with pytest.raises(PermissionError, match="Invalid API key"):
                await handler.start_run(
                    "graph-123",
                    RunRequest(),
                    auth_header="Bearer gc_test:wrong",
                )

        asyncio.run(run_test())

    def test_check_auth_rejects_missing_scope(self) -> None:
        """Test that _check_auth rejects missing scope."""

        async def run_test() -> None:
            auth = APIKeyAuthenticator()
            auth.register_key("gc_test", "secret", "test", ["run:view"])  # No execute scope

            manager = MockRunManager()
            handler = APIV1Handler(manager, auth=auth)

            with pytest.raises(PermissionError, match="Missing scope: run:execute"):
                await handler.start_run(
                    "graph-123",
                    RunRequest(),
                    auth_header="Bearer gc_test:secret",
                )

        asyncio.run(run_test())

    def test_check_auth_allows_no_auth_when_disabled(self) -> None:
        """Test that _check_auth allows calls when auth is None."""

        async def run_test() -> None:
            manager = MockRunManager()
            handler = APIV1Handler(manager, auth=None)

            # Should work without auth header
            response = await handler.start_run("graph-123", RunRequest())
            assert response.run_id == "run_1"

        asyncio.run(run_test())

    def test_check_auth_cancel_requires_cancel_scope(self) -> None:
        """Test that cancel requires run:cancel scope."""

        async def run_test() -> None:
            auth = APIKeyAuthenticator()
            auth.register_key("gc_test", "secret", "test", ["run:execute"])

            manager = MockRunManager()
            handler = APIV1Handler(manager, auth=auth)

            # Create run first (need execute scope)
            await handler.start_run(
                "graph-123",
                RunRequest(),
                auth_header="Bearer gc_test:secret",
            )

            # Cancel should fail without cancel scope
            with pytest.raises(PermissionError, match="Missing scope: run:cancel"):
                await handler.cancel_run("run_1", auth_header="Bearer gc_test:secret")

        asyncio.run(run_test())


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


class TestAPIV1OpenApi:
    def test_build_openapi_has_stable_paths_and_version(self) -> None:
        doc = build_api_v1_openapi_document()
        assert doc["openapi"] == "3.0.3"
        assert doc["info"]["version"] == GC_API_V1_OPENAPI_DOCUMENT_VERSION
        paths = doc["paths"]
        assert "/api/v1/openapi.json" in paths
        assert "/api/v1/graphs/{graph_id}/run" in paths
        assert "/api/v1/runs/{run_id}" in paths
        assert "/api/v1/runs/{run_id}/events" in paths
        assert "/api/v1/runs/{run_id}/cancel" in paths

    def test_get_openapi_json_route(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv("GC_RUN_BROKER_TOKEN", raising=False)
        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        r = client.get("/api/v1/openapi.json")
        assert r.status_code == 200
        body = r.json()
        assert body["openapi"] == "3.0.3"
        assert body["info"]["version"] == GC_API_V1_OPENAPI_DOCUMENT_VERSION

    def test_openapi_json_allowed_without_dev_token(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("GC_RUN_BROKER_TOKEN", "dev-only-secret")
        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        r = client.get("/api/v1/openapi.json")
        assert r.status_code == 200
        r2 = client.get("/health")
        assert r2.status_code == 401


class TestAPIV1Http:
    def test_post_run_returns_503_when_graphs_dir_unset(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("GC_RUN_BROKER_GRAPHS_DIR", raising=False)
        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        r = client.post(
            "/api/v1/graphs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/run",
            json={"inputs": {}},
        )
        assert r.status_code == 503
        assert "not configured" in r.json().get("error", "")

    def test_post_run_returns_404_for_missing_graph(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path
    ) -> None:
        graphs = tmp_path / "graphs"
        graphs.mkdir()
        monkeypatch.setenv("GC_RUN_BROKER_GRAPHS_DIR", str(graphs))
        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        r = client.post(
            "/api/v1/graphs/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/run",
            json={"inputs": {}},
        )
        assert r.status_code == 404

    def test_post_run_starts_and_get_returns_terminal_status(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path
    ) -> None:
        gid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        graphs = tmp_path / "graphs"
        graphs.mkdir()
        art = tmp_path / "artifacts"
        art.mkdir()
        (graphs / "doc.json").write_text(
            json.dumps(_minimal_valid_doc(gid)), encoding="utf-8"
        )
        monkeypatch.setenv("GC_RUN_BROKER_GRAPHS_DIR", str(graphs))
        monkeypatch.setenv("GC_RUN_BROKER_ARTIFACTS_BASE", str(art))

        monkeypatch.delenv("GC_RUN_BROKER_V1_API_KEYS", raising=False)

        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        start = client.post(f"/api/v1/graphs/{gid}/run", json={"inputs": {}})
        assert start.status_code == 200, start.text
        j0 = start.json()
        rid = j0["runId"]
        assert j0["graphId"] == gid
        assert j0["status"] == "started"

        status = None
        for _ in range(200):
            gr = client.get(f"/api/v1/runs/{rid}")
            assert gr.status_code == 200, gr.text
            status = gr.json().get("status")
            if status in ("success", "failed", "cancelled", "partial"):
                break
        assert status == "success"

        ev = client.get(f"/api/v1/runs/{rid}/events")
        assert ev.status_code == 200, ev.text
        assert ev.headers.get("X-GC-Events-Truncated") == "false"
        assert "application/x-ndjson" in (ev.headers.get("content-type") or "").lower()

    def test_get_run_events_404_unknown_run(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path
    ) -> None:
        graphs = tmp_path / "graphs"
        graphs.mkdir()
        monkeypatch.setenv("GC_RUN_BROKER_GRAPHS_DIR", str(graphs))
        monkeypatch.delenv("GC_RUN_BROKER_V1_API_KEYS", raising=False)
        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        r = client.get("/api/v1/runs/not-a-real-run-id/events")
        assert r.status_code == 404

    def test_get_run_events_rejects_bad_max_bytes(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path
    ) -> None:
        graphs = tmp_path / "graphs"
        graphs.mkdir()
        monkeypatch.setenv("GC_RUN_BROKER_GRAPHS_DIR", str(graphs))
        monkeypatch.delenv("GC_RUN_BROKER_V1_API_KEYS", raising=False)
        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        r = client.get(
            "/api/v1/runs/any/events",
            params={"maxBytes": "nope"},
        )
        assert r.status_code == 400

    def test_post_run_with_env_api_key(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path
    ) -> None:
        gid = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
        graphs = tmp_path / "graphs"
        graphs.mkdir()
        art = tmp_path / "artifacts"
        art.mkdir()
        (graphs / "doc.json").write_text(
            json.dumps(_minimal_valid_doc(gid)), encoding="utf-8"
        )
        monkeypatch.setenv("GC_RUN_BROKER_GRAPHS_DIR", str(graphs))
        monkeypatch.setenv("GC_RUN_BROKER_ARTIFACTS_BASE", str(art))
        monkeypatch.setenv("GC_RUN_BROKER_V1_API_KEYS", "gc_v1:secretv1")

        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        r0 = client.post(f"/api/v1/graphs/{gid}/run", json={})
        assert r0.status_code == 401

        r1 = client.post(
            f"/api/v1/graphs/{gid}/run",
            json={},
            headers={"Authorization": "Bearer gc_v1:secretv1"},
        )
        assert r1.status_code == 200, r1.text
        assert "runId" in r1.json()
