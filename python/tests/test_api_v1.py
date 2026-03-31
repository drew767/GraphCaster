# Copyright Aura. All Rights Reserved.

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from graph_caster.run_broker.auth.api_key import APIKey, APIKeyAuthenticator
from graph_caster.run_broker.routes.api_v1 import (
    APIV1Handler,
    CancelResponse,
    RunRequest,
    RunResponse,
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
