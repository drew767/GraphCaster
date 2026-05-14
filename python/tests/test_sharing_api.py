# Copyright GraphCaster. All Rights Reserved.

"""Tests for F86 sharing API routes."""

from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

pytest.importorskip("starlette")

from starlette.applications import Starlette
from starlette.routing import Route
from starlette.testclient import TestClient

from graph_caster.sharing import (
    ShareLink,
    ShareLinkStore,
    _RateLimiter,
    get_rate_limiter,
)
from graph_caster.run_broker.routes.sharing_routes import make_sharing_routes


def _make_run_manager() -> Any:
    mgr = MagicMock()
    mgr.start_run = AsyncMock(return_value="run-123")
    mgr.get_run_status = AsyncMock(return_value={"run_id": "run-123", "status": "running", "graph_id": "g1", "created_at": "2026-01-01T00:00:00Z"})
    mgr.get_run_events_ndjson = AsyncMock(return_value=("", False))
    return mgr


def _make_app(tmp_path: Path, run_manager: Any = None, rate_limit: int = 60) -> Starlette:
    store = ShareLinkStore(tmp_path)
    rm = run_manager or _make_run_manager()
    limiter = _RateLimiter()
    routes = make_sharing_routes(store, rm, rate_limiter=limiter, rate_limit=rate_limit)
    return Starlette(routes=routes)


def _auth_header() -> dict[str, str]:
    return {"Authorization": "Bearer test-key"}


class TestSharingCreateLink:
    def test_create_link_returns_share_link(self, tmp_path: Path) -> None:
        app = _make_app(tmp_path)
        with TestClient(app) as client:
            resp = client.post(
                "/api/v1/graphs/g1/share",
                json={"permissions": "view-and-run"},
                headers=_auth_header(),
            )
        assert resp.status_code == 201
        data = resp.json()
        assert data["graphId"] == "g1"
        assert data["permissions"] == "view-and-run"
        assert data["id"]
        assert "url" in data

    def test_create_link_with_expires_and_max_uses(self, tmp_path: Path) -> None:
        app = _make_app(tmp_path)
        with TestClient(app) as client:
            resp = client.post(
                "/api/v1/graphs/g1/share",
                json={
                    "permissions": "view",
                    "expires_at": "2099-12-31T00:00:00+00:00",
                    "max_uses": 100,
                    "metadata": {"title": "My workflow"},
                },
                headers=_auth_header(),
            )
        assert resp.status_code == 201
        data = resp.json()
        assert data["maxUses"] == 100
        assert data["expiresAt"] == "2099-12-31T00:00:00+00:00"
        assert data["metadata"]["title"] == "My workflow"

    def test_create_link_invalid_permissions(self, tmp_path: Path) -> None:
        app = _make_app(tmp_path)
        with TestClient(app) as client:
            resp = client.post(
                "/api/v1/graphs/g1/share",
                json={"permissions": "execute-all"},
                headers=_auth_header(),
            )
        assert resp.status_code == 400

    def test_create_link_missing_permissions(self, tmp_path: Path) -> None:
        app = _make_app(tmp_path)
        with TestClient(app) as client:
            resp = client.post(
                "/api/v1/graphs/g1/share",
                json={},
                headers=_auth_header(),
            )
        assert resp.status_code == 400


class TestSharingListLinks:
    def test_list_links_for_graph(self, tmp_path: Path) -> None:
        app = _make_app(tmp_path)
        with TestClient(app) as client:
            client.post("/api/v1/graphs/g1/share", json={"permissions": "view"}, headers=_auth_header())
            client.post("/api/v1/graphs/g1/share", json={"permissions": "run"}, headers=_auth_header())
            resp = client.get("/api/v1/graphs/g1/shares", headers=_auth_header())
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["links"]) == 2

    def test_list_links_empty(self, tmp_path: Path) -> None:
        app = _make_app(tmp_path)
        with TestClient(app) as client:
            resp = client.get("/api/v1/graphs/no-graph/shares", headers=_auth_header())
        assert resp.status_code == 200
        assert resp.json()["links"] == []


class TestSharingRevokeLink:
    def test_revoke_removes_link(self, tmp_path: Path) -> None:
        app = _make_app(tmp_path)
        with TestClient(app) as client:
            create_resp = client.post("/api/v1/graphs/g1/share", json={"permissions": "view"}, headers=_auth_header())
            link_id = create_resp.json()["id"]
            del_resp = client.delete(f"/api/v1/shares/{link_id}", headers=_auth_header())
        assert del_resp.status_code == 200
        assert del_resp.json()["revoked"] == link_id

    def test_revoke_unknown_link(self, tmp_path: Path) -> None:
        app = _make_app(tmp_path)
        with TestClient(app) as client:
            resp = client.delete("/api/v1/shares/no-such-link", headers=_auth_header())
        assert resp.status_code == 404


class TestPublicLanding:
    def test_get_public_landing_no_auth(self, tmp_path: Path) -> None:
        app = _make_app(tmp_path)
        with TestClient(app) as client:
            create_resp = client.post(
                "/api/v1/graphs/g1/share",
                json={"permissions": "view", "metadata": {"title": "Demo", "description": "Desc"}},
                headers=_auth_header(),
            )
            link_id = create_resp.json()["id"]
            resp = client.get(f"/api/v1/public/{link_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["graphId"] == "g1"
        assert data["permissions"] == "view"
        assert data["metadata"]["title"] == "Demo"

    def test_get_public_landing_unknown_link(self, tmp_path: Path) -> None:
        app = _make_app(tmp_path)
        with TestClient(app) as client:
            resp = client.get("/api/v1/public/no-such-link")
        assert resp.status_code == 404

    def test_get_public_landing_revoked_link(self, tmp_path: Path) -> None:
        app = _make_app(tmp_path)
        with TestClient(app) as client:
            create_resp = client.post("/api/v1/graphs/g1/share", json={"permissions": "view"}, headers=_auth_header())
            link_id = create_resp.json()["id"]
            client.delete(f"/api/v1/shares/{link_id}", headers=_auth_header())
            resp = client.get(f"/api/v1/public/{link_id}")
        assert resp.status_code == 404

    def test_get_public_landing_expired_link(self, tmp_path: Path) -> None:
        app = _make_app(tmp_path)
        with TestClient(app) as client:
            create_resp = client.post(
                "/api/v1/graphs/g1/share",
                json={"permissions": "view", "expires_at": "2000-01-01T00:00:00+00:00"},
                headers=_auth_header(),
            )
            link_id = create_resp.json()["id"]
            resp = client.get(f"/api/v1/public/{link_id}")
        assert resp.status_code == 410


class TestPublicRun:
    def test_run_with_view_only_permission_returns_403(self, tmp_path: Path) -> None:
        app = _make_app(tmp_path)
        with TestClient(app) as client:
            create_resp = client.post("/api/v1/graphs/g1/share", json={"permissions": "view"}, headers=_auth_header())
            link_id = create_resp.json()["id"]
            resp = client.post(f"/api/v1/public/{link_id}/run", json={"inputs": {}})
        assert resp.status_code == 403

    def test_run_with_run_permission_starts_run(self, tmp_path: Path) -> None:
        rm = _make_run_manager()
        app = _make_app(tmp_path, run_manager=rm)
        with TestClient(app) as client:
            create_resp = client.post("/api/v1/graphs/g1/share", json={"permissions": "run"}, headers=_auth_header())
            link_id = create_resp.json()["id"]
            resp = client.post(f"/api/v1/public/{link_id}/run", json={"inputs": {"x": 1}})
        assert resp.status_code == 200
        data = resp.json()
        assert "runId" in data

    def test_run_with_view_and_run_permission_starts_run(self, tmp_path: Path) -> None:
        rm = _make_run_manager()
        app = _make_app(tmp_path, run_manager=rm)
        with TestClient(app) as client:
            create_resp = client.post("/api/v1/graphs/g1/share", json={"permissions": "view-and-run"}, headers=_auth_header())
            link_id = create_resp.json()["id"]
            resp = client.post(f"/api/v1/public/{link_id}/run", json={"inputs": {}})
        assert resp.status_code == 200
        assert "runId" in resp.json()

    def test_run_with_revoked_link_returns_404(self, tmp_path: Path) -> None:
        app = _make_app(tmp_path)
        with TestClient(app) as client:
            create_resp = client.post("/api/v1/graphs/g1/share", json={"permissions": "run"}, headers=_auth_header())
            link_id = create_resp.json()["id"]
            client.delete(f"/api/v1/shares/{link_id}", headers=_auth_header())
            resp = client.post(f"/api/v1/public/{link_id}/run", json={"inputs": {}})
        assert resp.status_code == 404

    def test_run_with_exhausted_link_returns_410(self, tmp_path: Path) -> None:
        rm = _make_run_manager()
        app = _make_app(tmp_path, run_manager=rm)
        with TestClient(app) as client:
            create_resp = client.post("/api/v1/graphs/g1/share", json={"permissions": "run", "max_uses": 1}, headers=_auth_header())
            link_id = create_resp.json()["id"]
            client.post(f"/api/v1/public/{link_id}/run", json={"inputs": {}})
            resp = client.post(f"/api/v1/public/{link_id}/run", json={"inputs": {}})
        assert resp.status_code == 410

    def test_run_increments_uses(self, tmp_path: Path) -> None:
        rm = _make_run_manager()
        app = _make_app(tmp_path, run_manager=rm)
        with TestClient(app) as client:
            create_resp = client.post("/api/v1/graphs/g1/share", json={"permissions": "run"}, headers=_auth_header())
            link_id = create_resp.json()["id"]
            client.post(f"/api/v1/public/{link_id}/run", json={"inputs": {}})
            client.post(f"/api/v1/public/{link_id}/run", json={"inputs": {}})
            resp = client.get(f"/api/v1/public/{link_id}")
        assert resp.json()["uses"] == 2


class TestPublicRunEvents:
    def test_run_events_returns_404_for_unknown_run(self, tmp_path: Path) -> None:
        app = _make_app(tmp_path)
        with TestClient(app) as client:
            create_resp = client.post("/api/v1/graphs/g1/share", json={"permissions": "run"}, headers=_auth_header())
            link_id = create_resp.json()["id"]
            resp = client.get(f"/api/v1/public/{link_id}/runs/not-my-run/events")
        assert resp.status_code == 404

    def test_run_events_accessible_for_associated_run(self, tmp_path: Path) -> None:
        rm = _make_run_manager()
        app = _make_app(tmp_path, run_manager=rm)
        with TestClient(app) as client:
            create_resp = client.post("/api/v1/graphs/g1/share", json={"permissions": "run"}, headers=_auth_header())
            link_id = create_resp.json()["id"]
            run_resp = client.post(f"/api/v1/public/{link_id}/run", json={"inputs": {}})
            run_id = run_resp.json()["runId"]
            resp = client.get(f"/api/v1/public/{link_id}/runs/{run_id}/events")
        assert resp.status_code == 200


class TestRateLimit:
    def test_rate_limit_allows_up_to_limit(self, tmp_path: Path) -> None:
        app = _make_app(tmp_path, rate_limit=5)
        with TestClient(app) as client:
            create_resp = client.post("/api/v1/graphs/g1/share", json={"permissions": "view"}, headers=_auth_header())
            link_id = create_resp.json()["id"]
            statuses = []
            for _ in range(5):
                r = client.get(f"/api/v1/public/{link_id}")
                statuses.append(r.status_code)
        assert all(s == 200 for s in statuses)

    def test_61st_request_returns_429(self, tmp_path: Path) -> None:
        limiter = _RateLimiter()
        app = _make_app(tmp_path, rate_limit=60)
        with TestClient(app) as client:
            create_resp = client.post("/api/v1/graphs/g1/share", json={"permissions": "view"}, headers=_auth_header())
            link_id = create_resp.json()["id"]
            for _ in range(60):
                client.get(f"/api/v1/public/{link_id}")
            resp = client.get(f"/api/v1/public/{link_id}")
        assert resp.status_code == 429
        assert "Retry-After" in resp.headers

    def test_429_has_retry_after_header(self, tmp_path: Path) -> None:
        app = _make_app(tmp_path, rate_limit=1)
        with TestClient(app) as client:
            create_resp = client.post("/api/v1/graphs/g1/share", json={"permissions": "view"}, headers=_auth_header())
            link_id = create_resp.json()["id"]
            client.get(f"/api/v1/public/{link_id}")
            resp = client.get(f"/api/v1/public/{link_id}")
        assert resp.status_code == 429
        retry_after = resp.headers.get("Retry-After")
        assert retry_after is not None
        assert int(retry_after) >= 1
