# Copyright GraphCaster. All Rights Reserved.

"""API-layer tests for SSO provider config endpoints, 6 tests."""

from __future__ import annotations

import pytest

pytest.importorskip("starlette")

from starlette.applications import Starlette
from starlette.testclient import TestClient

from graph_caster.auth.sso_config import InMemorySsoConfigStore
from graph_caster.auth.sso_config_routes import make_sso_config_routes


def _make_client() -> tuple[TestClient, InMemorySsoConfigStore]:
    store = InMemorySsoConfigStore()
    app = Starlette(routes=make_sso_config_routes(store))
    return TestClient(app, raise_server_exceptions=True), store


_ADMIN = {"Authorization": "Bearer admin", "X-Tenant-Id": "t1"}
_ANON: dict = {}

_GOOGLE_PAYLOAD = {
    "enabled": True,
    "client_id": "gid",
    "client_secret_encrypted": "enc",
    "redirect_uri": "https://app/callback",
}


def test_list_providers_empty():
    client, _ = _make_client()
    r = client.get("/api/v1/sso/providers", headers=_ADMIN)
    assert r.status_code == 200
    assert r.json()["providers"] == []


def test_upsert_and_get_provider():
    client, _ = _make_client()
    r = client.put("/api/v1/sso/providers/google", json=_GOOGLE_PAYLOAD, headers=_ADMIN)
    assert r.status_code == 200
    data = r.json()
    assert data["provider"] == "google"
    assert data["client_id"] == "gid"
    assert "client_secret_encrypted" not in data

    r2 = client.get("/api/v1/sso/providers/google", headers=_ADMIN)
    assert r2.status_code == 200
    assert r2.json()["enabled"] is True


def test_get_unknown_provider():
    client, _ = _make_client()
    r = client.get("/api/v1/sso/providers/unknown-provider", headers=_ADMIN)
    assert r.status_code == 404


def test_delete_provider():
    client, _ = _make_client()
    client.put("/api/v1/sso/providers/github", json={**_GOOGLE_PAYLOAD, "client_id": "gh"}, headers=_ADMIN)
    r = client.delete("/api/v1/sso/providers/github", headers=_ADMIN)
    assert r.status_code == 200
    assert r.json()["deleted"] == "github"
    assert client.get("/api/v1/sso/providers/github", headers=_ADMIN).status_code == 404


def test_test_provider_not_configured():
    client, _ = _make_client()
    r = client.post("/api/v1/sso/providers/microsoft/test", headers=_ADMIN)
    assert r.status_code == 422
    assert r.json()["ok"] is False


def test_unauthorized_returns_401():
    client, _ = _make_client()
    for method, path in [
        ("GET", "/api/v1/sso/providers"),
        ("PUT", "/api/v1/sso/providers/google"),
        ("DELETE", "/api/v1/sso/providers/google"),
    ]:
        r = client.request(method, path, headers=_ANON)
        assert r.status_code == 401, f"{method} {path} should be 401"
