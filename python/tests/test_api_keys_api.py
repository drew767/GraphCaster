# Copyright GraphCaster. All Rights Reserved.

"""Tests for API keys REST API (5 tests)."""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

pytest.importorskip("starlette")

from starlette.applications import Starlette
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.testclient import TestClient

from graph_caster.auth.api_keys import ApiKeyStore
from graph_caster.auth.rbac import Principal, Role
from graph_caster.run_broker.routes.api_keys_routes import make_api_keys_routes


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
    store = ApiKeyStore(tmp_path)
    routes = make_api_keys_routes(store)
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


class TestApiKeysAPI:
    def test_create_api_key_returns_raw_key_once(self, tmp_path: Path) -> None:
        p = _principal()
        resp = TestClient(_make_app(tmp_path, p)).post(
            "/api/v1/api-keys",
            json={"label": "CI Token", "scopes": ["run:execute", "run:view"]},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert "raw_key" in data
        assert data["raw_key"].startswith("gc_")
        assert data["api_key"]["label"] == "CI Token"
        assert "key_hash" not in data["api_key"]

    def test_list_api_keys(self, tmp_path: Path) -> None:
        store = ApiKeyStore(tmp_path)
        _run(store.create("u1", "t1", "Key A", ["run:view"]))
        _run(store.create("u1", "t1", "Key B", ["run:execute"]))
        p = _principal()
        resp = TestClient(_make_app(tmp_path, p)).get("/api/v1/api-keys")
        assert resp.status_code == 200
        keys = resp.json()["api_keys"]
        assert len(keys) == 2
        assert all("key_hash" not in k for k in keys)

    def test_revoke_api_key(self, tmp_path: Path) -> None:
        store = ApiKeyStore(tmp_path)
        rec, _ = _run(store.create("u1", "t1", "Temp", []))
        p = _principal()
        resp = TestClient(_make_app(tmp_path, p)).delete(f"/api/v1/api-keys/{rec.id}")
        assert resp.status_code == 204
        remaining = _run(store.list("u1", "t1"))
        assert remaining == []

    def test_unauthenticated_returns_401(self, tmp_path: Path) -> None:
        resp = TestClient(_make_app(tmp_path)).get("/api/v1/api-keys")
        assert resp.status_code == 401

    def test_middleware_integration_verify(self, tmp_path: Path) -> None:
        """Verify a created key can be authenticated via ApiKeyStore.verify."""
        store = ApiKeyStore(tmp_path)
        rec, raw_key = _run(store.create("u1", "t1", "Middleware Key", ["run:execute"]))
        found = _run(store.verify(raw_key))
        assert found is not None
        assert found.id == rec.id
        assert "run:execute" in found.scopes

    def test_create_missing_label_returns_400(self, tmp_path: Path) -> None:
        p = _principal()
        resp = TestClient(_make_app(tmp_path, p)).post(
            "/api/v1/api-keys",
            json={"scopes": ["run:view"]},
        )
        assert resp.status_code == 400
