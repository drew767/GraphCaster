# Copyright GraphCaster. All Rights Reserved.

"""Tests for users REST API (6 tests)."""

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

from graph_caster.auth.rbac import Principal, Role
from graph_caster.tenancy.models import Tenant, TenantMembership, User
from graph_caster.tenancy.service import TenantService
from graph_caster.tenancy.store import InMemoryTenantStore
from graph_caster.run_broker.routes.users_routes import make_users_routes


def _run(coro):
    return asyncio.run(coro)


class _InjectPrincipalMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, principal: Principal) -> None:
        super().__init__(app)
        self._principal = principal

    async def dispatch(self, request: Request, call_next):
        request.scope["principal"] = self._principal
        return await call_next(request)


def _make_service() -> TenantService:
    return TenantService(InMemoryTenantStore())


def _make_app(service: TenantService, principal: Principal | None = None) -> Starlette:
    routes = make_users_routes(service)
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


def _setup_tenant(store: InMemoryTenantStore) -> None:
    _run(store.create_tenant(Tenant(id="t1", name="T1", created_at="2026-01-01")))
    _run(store.create_user(User(id="u1", email="admin@a.com", name="Admin", created_at="2026-01-01")))
    _run(store.add_membership(TenantMembership("u1", "t1", "admin", "2026-01-01")))


class TestUsersAPI:
    def test_list_users(self) -> None:
        svc = _make_service()
        store = svc._store
        _setup_tenant(store)
        _run(store.create_user(User(id="u2", email="b@b.com", name="Bob", created_at="2026-01-01")))
        _run(store.add_membership(TenantMembership("u2", "t1", "editor", "2026-01-01")))

        p = _principal(user_id="u1", tenant_id="t1")
        resp = TestClient(_make_app(svc, p)).get("/api/v1/users")
        assert resp.status_code == 200
        users = resp.json()["users"]
        assert len(users) == 2

    def test_list_users_role_filter(self) -> None:
        svc = _make_service()
        store = svc._store
        _setup_tenant(store)
        _run(store.create_user(User(id="u2", email="b@b.com", name="Bob", created_at="2026-01-01")))
        _run(store.add_membership(TenantMembership("u2", "t1", "editor", "2026-01-01")))

        p = _principal(user_id="u1", tenant_id="t1")
        resp = TestClient(_make_app(svc, p)).get("/api/v1/users?role=editor")
        assert resp.status_code == 200
        users = resp.json()["users"]
        assert len(users) == 1
        assert users[0]["role"] == "editor"

    def test_invite_user(self) -> None:
        svc = _make_service()
        store = svc._store
        _setup_tenant(store)

        p = _principal(user_id="u1", tenant_id="t1")
        resp = TestClient(_make_app(svc, p)).post(
            "/api/v1/users/invite",
            json={"email": "newbie@example.com", "role": "editor"},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert "invite_token" in data
        assert "invite_url" in data
        assert data["invite_token"]

    def test_accept_invite(self) -> None:
        svc = _make_service()
        store = svc._store
        _setup_tenant(store)
        token = _run(svc.invite_member("t1", "newbie@example.com", "viewer"))

        app = _make_app(svc)
        resp = TestClient(app).post(
            "/api/v1/users/accept-invite",
            json={"token": token, "password": "MyPass123"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["user"]["email"] == "newbie@example.com"
        assert data["user"]["role"] == "viewer"

    def test_change_user_role(self) -> None:
        svc = _make_service()
        store = svc._store
        _setup_tenant(store)
        _run(store.create_user(User(id="u2", email="ed@a.com", name="Ed", created_at="2026-01-01")))
        _run(store.add_membership(TenantMembership("u2", "t1", "viewer", "2026-01-01")))

        p = _principal(user_id="u1", tenant_id="t1")
        resp = TestClient(_make_app(svc, p)).patch("/api/v1/users/u2", json={"role": "editor"})
        assert resp.status_code == 200
        assert resp.json()["role"] == "editor"

    def test_delete_user(self) -> None:
        svc = _make_service()
        store = svc._store
        _setup_tenant(store)
        _run(store.create_user(User(id="u2", email="ed@a.com", name="Ed", created_at="2026-01-01")))
        _run(store.add_membership(TenantMembership("u2", "t1", "editor", "2026-01-01")))

        p = _principal(user_id="u1", tenant_id="t1")
        resp = TestClient(_make_app(svc, p)).delete("/api/v1/users/u2")
        assert resp.status_code == 204
        remaining = _run(store.list_memberships("t1"))
        assert not any(m.user_id == "u2" for m in remaining)
