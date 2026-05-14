# Copyright GraphCaster. All Rights Reserved.

"""F84 RBAC middleware integration tests.

Tests that:
- Endpoints protected by require_scope correctly allow/deny by role.
- API key with limited scope only reaches allowed endpoints.
- OWNER-equivalent key (scope "*") can access all protected endpoints.
- 403 is returned (not 401) when authenticated but scope missing.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

pytest.importorskip("starlette")

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route
from starlette.testclient import TestClient

from graph_caster.auth.rbac import Principal, Role, require_scope


# ---------------------------------------------------------------------------
# Minimal Starlette app wired with PrincipalMiddleware-equivalent logic
#
# Rather than booting the full RunBroker app (which requires graph files and
# env vars), we build a tiny Starlette app that exercises PrincipalMiddleware
# logic via a helper that injects principal directly into request.scope.
# This keeps the tests fast and dependency-free.
# ---------------------------------------------------------------------------


def _make_test_app(principal: Principal | None) -> Starlette:
    """Return a Starlette app that pre-populates request.scope["principal"]."""

    @require_scope("run:execute")
    async def run_execute_ep(request: Request) -> Response:
        return JSONResponse({"ok": True, "endpoint": "run:execute"})

    @require_scope("run:cancel")
    async def run_cancel_ep(request: Request) -> Response:
        return JSONResponse({"ok": True, "endpoint": "run:cancel"})

    @require_scope("audit:read")
    async def audit_read_ep(request: Request) -> Response:
        return JSONResponse({"ok": True, "endpoint": "audit:read"})

    @require_scope("graph:publish")
    async def graph_publish_ep(request: Request) -> Response:
        return JSONResponse({"ok": True, "endpoint": "graph:publish"})

    async def inject_and_forward(request: Request, endpoint: Any) -> Response:
        if principal is not None:
            request.scope["principal"] = principal
        return await endpoint(request)

    async def _run_execute(r: Request) -> Response:
        return await inject_and_forward(r, run_execute_ep)

    async def _run_cancel(r: Request) -> Response:
        return await inject_and_forward(r, run_cancel_ep)

    async def _audit_read(r: Request) -> Response:
        return await inject_and_forward(r, audit_read_ep)

    async def _graph_publish(r: Request) -> Response:
        return await inject_and_forward(r, graph_publish_ep)

    app = Starlette(
        routes=[
            Route("/run-execute", _run_execute, methods=["POST"]),
            Route("/run-cancel", _run_cancel, methods=["POST"]),
            Route("/audit-read", _audit_read, methods=["GET"]),
            Route("/graph-publish", _graph_publish, methods=["POST"]),
        ]
    )
    return app


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _viewer() -> Principal:
    return Principal(user_id="u-viewer", tenant_id="t1", role=Role.VIEWER)


def _editor() -> Principal:
    return Principal(user_id="u-editor", tenant_id="t1", role=Role.EDITOR)


def _owner() -> Principal:
    return Principal(user_id="u-owner", tenant_id="t1", role=Role.OWNER)


def _api_key_run_view_only() -> Principal:
    return Principal(
        user_id="apikey:kid1",
        tenant_id="default",
        role=Role.ADMIN,
        api_key_scopes={"run:view"},
    )


def _api_key_all() -> Principal:
    return Principal(
        user_id="apikey:kid2",
        tenant_id="default",
        role=Role.VIEWER,
        api_key_scopes={"*"},
    )


# ---------------------------------------------------------------------------
# run:execute tests
# ---------------------------------------------------------------------------


class TestRunExecuteScope:
    def test_viewer_gets_403_on_run_execute(self) -> None:
        client = TestClient(_make_test_app(_viewer()))
        r = client.post("/run-execute")
        assert r.status_code == 403
        body = r.json()
        assert "run:execute" in body.get("error", "")

    def test_editor_gets_200_on_run_execute(self) -> None:
        client = TestClient(_make_test_app(_editor()))
        r = client.post("/run-execute")
        assert r.status_code == 200
        assert r.json()["ok"] is True

    def test_owner_wildcard_gets_200_on_run_execute(self) -> None:
        client = TestClient(_make_test_app(_owner()))
        r = client.post("/run-execute")
        assert r.status_code == 200

    def test_no_principal_gets_401(self) -> None:
        client = TestClient(_make_test_app(None))
        r = client.post("/run-execute")
        assert r.status_code == 401


# ---------------------------------------------------------------------------
# run:cancel tests
# ---------------------------------------------------------------------------


class TestRunCancelScope:
    def test_viewer_gets_403(self) -> None:
        client = TestClient(_make_test_app(_viewer()))
        r = client.post("/run-cancel")
        assert r.status_code == 403

    def test_editor_gets_200(self) -> None:
        client = TestClient(_make_test_app(_editor()))
        r = client.post("/run-cancel")
        assert r.status_code == 200


# ---------------------------------------------------------------------------
# audit:read tests
# ---------------------------------------------------------------------------


class TestAuditReadScope:
    def test_viewer_gets_403_on_audit(self) -> None:
        client = TestClient(_make_test_app(_viewer()))
        r = client.get("/audit-read")
        assert r.status_code == 403

    def test_editor_gets_403_on_audit(self) -> None:
        client = TestClient(_make_test_app(_editor()))
        r = client.get("/audit-read")
        assert r.status_code == 403

    def test_owner_gets_200_on_audit(self) -> None:
        client = TestClient(_make_test_app(_owner()))
        r = client.get("/audit-read")
        assert r.status_code == 200


# ---------------------------------------------------------------------------
# graph:publish tests
# ---------------------------------------------------------------------------


class TestGraphPublishScope:
    def test_viewer_gets_403_on_publish(self) -> None:
        client = TestClient(_make_test_app(_viewer()))
        r = client.post("/graph-publish")
        assert r.status_code == 403

    def test_editor_gets_403_on_publish(self) -> None:
        client = TestClient(_make_test_app(_editor()))
        r = client.post("/graph-publish")
        assert r.status_code == 403

    def test_admin_gets_200_on_publish(self) -> None:
        p = Principal(user_id="u-admin", tenant_id="t1", role=Role.ADMIN)
        client = TestClient(_make_test_app(p))
        r = client.post("/graph-publish")
        assert r.status_code == 200

    def test_owner_gets_200_on_publish(self) -> None:
        client = TestClient(_make_test_app(_owner()))
        r = client.post("/graph-publish")
        assert r.status_code == 200


# ---------------------------------------------------------------------------
# API key scope override tests
# ---------------------------------------------------------------------------


class TestApiKeyScopeOverride:
    def test_limited_api_key_denied_run_execute(self) -> None:
        client = TestClient(_make_test_app(_api_key_run_view_only()))
        r = client.post("/run-execute")
        assert r.status_code == 403

    def test_limited_api_key_denied_audit(self) -> None:
        client = TestClient(_make_test_app(_api_key_run_view_only()))
        r = client.get("/audit-read")
        assert r.status_code == 403

    def test_wildcard_api_key_accesses_everything(self) -> None:
        client = TestClient(_make_test_app(_api_key_all()))
        assert client.post("/run-execute").status_code == 200
        assert client.post("/run-cancel").status_code == 200
        assert client.get("/audit-read").status_code == 200
        assert client.post("/graph-publish").status_code == 200


# ---------------------------------------------------------------------------
# PrincipalMiddleware: resolve Principal from GC_RUN_BROKER_V1_API_KEYS
# ---------------------------------------------------------------------------


class TestPrincipalMiddlewareResolution:
    """Smoke test: PrincipalMiddleware populates request.scope["principal"]
    from a Bearer API key set via GC_RUN_BROKER_V1_API_KEYS.
    """

    def test_middleware_populates_principal_from_env_key(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("GC_RUN_BROKER_V1_API_KEYS", "kid_test:supersecret")
        monkeypatch.delenv("GC_RUN_BROKER_TOKEN", raising=False)

        from graph_caster.auth.rbac import Principal as _Principal
        from graph_caster.run_broker.routes.middleware import PrincipalMiddleware

        captured: list[_Principal | None] = []

        async def _endpoint(request: Request) -> Response:
            captured.append(request.scope.get("principal"))
            return JSONResponse({"ok": True})

        app = Starlette(routes=[Route("/probe", _endpoint, methods=["GET"])])
        app.add_middleware(PrincipalMiddleware)

        client = TestClient(app)
        r = client.get("/probe", headers={"Authorization": "Bearer kid_test:supersecret"})
        assert r.status_code == 200
        assert len(captured) == 1
        p = captured[0]
        assert p is not None
        assert p.user_id == "apikey:kid_test"
        assert "run:execute" in p.effective_scopes

    def test_middleware_no_header_leaves_no_principal(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("GC_RUN_BROKER_V1_API_KEYS", "kid_test:supersecret")
        monkeypatch.delenv("GC_RUN_BROKER_TOKEN", raising=False)

        from graph_caster.run_broker.routes.middleware import PrincipalMiddleware

        captured: list[object] = []

        async def _endpoint(request: Request) -> Response:
            captured.append(request.scope.get("principal", "MISSING"))
            return JSONResponse({"ok": True})

        app = Starlette(routes=[Route("/probe", _endpoint, methods=["GET"])])
        app.add_middleware(PrincipalMiddleware)

        client = TestClient(app)
        r = client.get("/probe")
        assert r.status_code == 200
        assert captured[0] == "MISSING"
