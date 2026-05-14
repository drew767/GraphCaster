# Copyright GraphCaster. All Rights Reserved.

"""API-layer tests for Secrets Providers config endpoints, 5 tests."""

from __future__ import annotations

import pytest

pytest.importorskip("starlette")

from starlette.applications import Starlette
from starlette.testclient import TestClient

from graph_caster.auth.secrets_providers_config import InMemorySecretsProvidersConfigStore
from graph_caster.auth.secrets_providers_routes import make_secrets_providers_routes


def _make_client() -> tuple[TestClient, InMemorySecretsProvidersConfigStore]:
    store = InMemorySecretsProvidersConfigStore()
    app = Starlette(routes=make_secrets_providers_routes(store))
    return TestClient(app, raise_server_exceptions=True), store


_ADMIN = {"Authorization": "Bearer admin"}
_ANON: dict = {}


def test_list_providers():
    client, _ = _make_client()
    r = client.get("/api/v1/secrets/providers", headers=_ADMIN)
    assert r.status_code == 200
    providers = r.json()["providers"]
    ids = {p["provider_id"] for p in providers}
    assert "file" in ids
    assert "vault" in ids
    assert "aws-sm" in ids


def test_update_file_provider():
    client, _ = _make_client()
    r = client.put(
        "/api/v1/secrets/providers/file",
        json={"config": {"path": "/etc/secrets.env"}},
        headers=_ADMIN,
    )
    assert r.status_code == 200
    data = r.json()
    assert data["provider_id"] == "file"
    assert data["config"]["path"] == "/etc/secrets.env"


def test_update_unknown_provider():
    client, _ = _make_client()
    r = client.put(
        "/api/v1/secrets/providers/unknown-backend",
        json={"config": {}},
        headers=_ADMIN,
    )
    assert r.status_code == 404


def test_test_file_provider_no_path():
    client, _ = _make_client()
    r = client.post("/api/v1/secrets/providers/file/test", headers=_ADMIN)
    assert r.status_code in (200, 422)
    assert "ok" in r.json()


def test_unauthorized():
    client, _ = _make_client()
    r = client.get("/api/v1/secrets/providers", headers=_ANON)
    assert r.status_code == 401
