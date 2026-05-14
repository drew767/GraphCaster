# Copyright GraphCaster. All Rights Reserved.

"""API-layer tests for Projects endpoints, 10 tests."""

from __future__ import annotations

import pytest

pytest.importorskip("starlette")

from starlette.applications import Starlette
from starlette.testclient import TestClient

from graph_caster.projects.store import InMemoryProjectStore
from graph_caster.projects.routes import make_projects_routes


def _make_client() -> tuple[TestClient, InMemoryProjectStore]:
    store = InMemoryProjectStore()
    app = Starlette(routes=make_projects_routes(store))
    return TestClient(app, raise_server_exceptions=True), store


_HEADERS = {"X-Tenant-Id": "t1", "Authorization": "Bearer tok"}


def test_list_projects_empty():
    client, _ = _make_client()
    r = client.get("/api/v1/projects", headers=_HEADERS)
    assert r.status_code == 200
    assert r.json()["projects"] == []


def test_create_project():
    client, _ = _make_client()
    r = client.post("/api/v1/projects", json={"name": "Alpha", "color": "#f00"}, headers=_HEADERS)
    assert r.status_code == 201
    data = r.json()
    assert data["name"] == "Alpha"
    assert data["color"] == "#f00"
    assert data["id"]


def test_create_project_missing_name():
    client, _ = _make_client()
    r = client.post("/api/v1/projects", json={"description": "x"}, headers=_HEADERS)
    assert r.status_code == 400
    assert "name" in r.json()["error"]


def test_get_project():
    client, _ = _make_client()
    created = client.post("/api/v1/projects", json={"name": "Beta"}, headers=_HEADERS).json()
    pid = created["id"]
    r = client.get(f"/api/v1/projects/{pid}", headers=_HEADERS)
    assert r.status_code == 200
    assert r.json()["name"] == "Beta"


def test_get_project_not_found():
    client, _ = _make_client()
    r = client.get("/api/v1/projects/does-not-exist", headers=_HEADERS)
    assert r.status_code == 404


def test_patch_project():
    client, _ = _make_client()
    pid = client.post("/api/v1/projects", json={"name": "Old"}, headers=_HEADERS).json()["id"]
    r = client.patch(f"/api/v1/projects/{pid}", json={"name": "New", "color": "#0f0"}, headers=_HEADERS)
    assert r.status_code == 200
    data = r.json()
    assert data["name"] == "New"
    assert data["color"] == "#0f0"


def test_delete_project():
    client, _ = _make_client()
    pid = client.post("/api/v1/projects", json={"name": "Gone"}, headers=_HEADERS).json()["id"]
    r = client.delete(f"/api/v1/projects/{pid}", headers=_HEADERS)
    assert r.status_code == 200
    assert r.json()["deleted"] == pid
    assert client.get(f"/api/v1/projects/{pid}", headers=_HEADERS).status_code == 404


def test_invite_and_list_members():
    client, _ = _make_client()
    pid = client.post("/api/v1/projects", json={"name": "Team"}, headers=_HEADERS).json()["id"]
    r = client.post(
        f"/api/v1/projects/{pid}/members/invite",
        json={"email": "alice@ex.com", "role": "editor"},
        headers=_HEADERS,
    )
    assert r.status_code == 201
    assert r.json()["role"] == "editor"
    members = client.get(f"/api/v1/projects/{pid}/members", headers=_HEADERS).json()["members"]
    assert len(members) == 1


def test_remove_member():
    client, _ = _make_client()
    pid = client.post("/api/v1/projects", json={"name": "Team2"}, headers=_HEADERS).json()["id"]
    invite_r = client.post(
        f"/api/v1/projects/{pid}/members/invite",
        json={"email": "bob@ex.com", "role": "viewer"},
        headers=_HEADERS,
    ).json()
    user_id = invite_r["userId"]
    r = client.delete(f"/api/v1/projects/{pid}/members/{user_id}", headers=_HEADERS)
    assert r.status_code == 200
    members = client.get(f"/api/v1/projects/{pid}/members", headers=_HEADERS).json()["members"]
    assert members == []


def test_project_resources_endpoints():
    client, _ = _make_client()
    pid = client.post("/api/v1/projects", json={"name": "Res"}, headers=_HEADERS).json()["id"]
    for sub in ("workflows", "credentials", "variables"):
        r = client.get(f"/api/v1/projects/{pid}/{sub}", headers=_HEADERS)
        assert r.status_code == 200
        assert sub in r.json()
