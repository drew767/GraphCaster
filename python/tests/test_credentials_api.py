# Copyright GraphCaster. All Rights Reserved.

"""Tests for credentials REST API (8 tests)."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pytest

pytest.importorskip("starlette")

from starlette.applications import Starlette
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.testclient import TestClient

from graph_caster.credentials.store import CredentialStore
from graph_caster.auth.rbac import Principal, Role
from graph_caster.run_broker.routes.credentials_routes import make_credentials_routes


def _run(coro):
    return asyncio.run(coro)


class _InjectPrincipalMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, principal: Principal) -> None:
        super().__init__(app)
        self._principal = principal

    async def dispatch(self, request: Request, call_next):
        request.scope["principal"] = self._principal
        return await call_next(request)


def _make_app(tmp_path: Path, principal: Principal | None = None) -> Starlette:
    store = CredentialStore(tmp_path)
    routes = make_credentials_routes(store)
    app = Starlette(routes=routes)
    if principal is not None:
        app.add_middleware(_InjectPrincipalMiddleware, principal=principal)
    return app


def _principal(
    user_id: str = "u1",
    tenant_id: str = "t1",
    role: Role = Role.ADMIN,
) -> Principal:
    return Principal(user_id=user_id, tenant_id=tenant_id, role=role)


class TestCredentialsAPI:
    def test_create_credential(self, tmp_path: Path) -> None:
        p = _principal()
        client = TestClient(_make_app(tmp_path, p))
        resp = client.post(
            "/api/v1/credentials",
            json={"name": "My OpenAI", "type": "openai", "fields": {"api_key": "sk-test"}},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "My OpenAI"
        assert data["type"] == "openai"
        assert data["fields"]["api_key"] == "***"

    def test_list_credentials(self, tmp_path: Path) -> None:
        store = CredentialStore(tmp_path)
        _run(store.create("t1", "K1", "openai", {"api_key": "a"}))
        _run(store.create("t1", "K2", "anthropic", {"api_key": "b"}))
        p = _principal()
        resp = TestClient(_make_app(tmp_path, p)).get("/api/v1/credentials")
        assert resp.status_code == 200
        assert len(resp.json()["credentials"]) == 2

    def test_list_with_type_filter(self, tmp_path: Path) -> None:
        store = CredentialStore(tmp_path)
        _run(store.create("t1", "K1", "openai", {"api_key": "a"}))
        _run(store.create("t1", "K2", "anthropic", {"api_key": "b"}))
        p = _principal()
        resp = TestClient(_make_app(tmp_path, p)).get("/api/v1/credentials?type=openai")
        assert resp.status_code == 200
        creds = resp.json()["credentials"]
        assert len(creds) == 1
        assert creds[0]["type"] == "openai"

    def test_get_credential_by_id(self, tmp_path: Path) -> None:
        store = CredentialStore(tmp_path)
        rec = _run(store.create("t1", "Github Tok", "github", {"token": "gh-xxx"}))
        p = _principal()
        resp = TestClient(_make_app(tmp_path, p)).get(f"/api/v1/credentials/{rec.id}")
        assert resp.status_code == 200
        assert resp.json()["id"] == rec.id

    def test_get_credential_not_found(self, tmp_path: Path) -> None:
        p = _principal()
        resp = TestClient(_make_app(tmp_path, p)).get("/api/v1/credentials/nonexistent-id")
        assert resp.status_code == 404

    def test_patch_credential(self, tmp_path: Path) -> None:
        store = CredentialStore(tmp_path)
        rec = _run(store.create("t1", "Old", "openai", {"api_key": "old-key"}))
        p = _principal()
        resp = TestClient(_make_app(tmp_path, p)).patch(
            f"/api/v1/credentials/{rec.id}",
            json={"name": "New name"},
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "New name"

    def test_delete_credential(self, tmp_path: Path) -> None:
        store = CredentialStore(tmp_path)
        rec = _run(store.create("t1", "Temp", "custom", {}))
        p = _principal()
        client = TestClient(_make_app(tmp_path, p))
        resp = client.delete(f"/api/v1/credentials/{rec.id}")
        assert resp.status_code == 204

    def test_scope_enforcement_viewer_cannot_write(self, tmp_path: Path) -> None:
        p = _principal(role=Role.VIEWER)
        resp = TestClient(_make_app(tmp_path, p)).post(
            "/api/v1/credentials",
            json={"name": "X", "type": "openai", "fields": {"api_key": "k"}},
        )
        assert resp.status_code == 403

    def test_unauthenticated_returns_401(self, tmp_path: Path) -> None:
        resp = TestClient(_make_app(tmp_path)).get("/api/v1/credentials")
        assert resp.status_code == 401

    def test_invalid_type_returns_400(self, tmp_path: Path) -> None:
        p = _principal()
        resp = TestClient(_make_app(tmp_path, p)).post(
            "/api/v1/credentials",
            json={"name": "X", "type": "invalid-type", "fields": {}},
        )
        assert resp.status_code == 400

    def test_test_credential_endpoint(self, tmp_path: Path) -> None:
        store = CredentialStore(tmp_path)
        rec = _run(store.create("t1", "Bearer", "api-key", {"api_key": "my-token"}))
        p = _principal()
        resp = TestClient(_make_app(tmp_path, p)).post(f"/api/v1/credentials/{rec.id}/test")
        assert resp.status_code == 200
        data = resp.json()
        assert "ok" in data
        assert "message" in data
