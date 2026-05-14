# Copyright GraphCaster. All Rights Reserved.

"""API-layer tests for Source Control endpoints, 7 tests."""

from __future__ import annotations

import subprocess
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

pytest.importorskip("starlette")

from starlette.applications import Starlette
from starlette.testclient import TestClient

from graph_caster.source_control.git_ops import Commit, GitCommandError, SourceControlManager
from graph_caster.source_control.routes import make_source_control_routes


def _make_manager(tmp_path: Path) -> SourceControlManager:
    ws = tmp_path / "ws"
    ws.mkdir(parents=True, exist_ok=True)
    return SourceControlManager(ws)


def _make_client(manager: SourceControlManager) -> TestClient:
    app = Starlette(routes=make_source_control_routes(manager))
    return TestClient(app, raise_server_exceptions=True)


_AUTH = {"Authorization": "Bearer tok"}
_ANON: dict = {}


def test_status_not_connected(tmp_path: Path):
    mgr = _make_manager(tmp_path)
    client = _make_client(mgr)
    r = client.get("/api/v1/source-control/status", headers=_AUTH)
    assert r.status_code == 200
    assert r.json()["connected"] is False


def test_connect(tmp_path: Path):
    mgr = _make_manager(tmp_path)
    client = _make_client(mgr)
    with patch.object(mgr, "connect", new=AsyncMock(return_value=None)):
        r = client.post(
            "/api/v1/source-control/connect",
            json={"repo_url": "https://github.com/org/repo.git", "branch": "main"},
            headers=_AUTH,
        )
    assert r.status_code == 200
    assert r.json()["connected"] is True


def test_connect_missing_repo_url(tmp_path: Path):
    mgr = _make_manager(tmp_path)
    client = _make_client(mgr)
    r = client.post("/api/v1/source-control/connect", json={"branch": "main"}, headers=_AUTH)
    assert r.status_code == 400
    assert "repo_url" in r.json()["error"]


def test_disconnect(tmp_path: Path):
    mgr = _make_manager(tmp_path)
    client = _make_client(mgr)
    with patch.object(mgr, "disconnect", new=AsyncMock(return_value=None)):
        r = client.post("/api/v1/source-control/disconnect", headers=_AUTH)
    assert r.status_code == 200
    assert r.json()["disconnected"] is True


def test_pull(tmp_path: Path):
    mgr = _make_manager(tmp_path)
    client = _make_client(mgr)
    with patch.object(mgr, "pull", new=AsyncMock(return_value={"applied": ["ok"], "conflicts": []})):
        r = client.post("/api/v1/source-control/pull", json={"force": False}, headers=_AUTH)
    assert r.status_code == 200
    assert r.json()["conflicts"] == []


def test_push(tmp_path: Path):
    mgr = _make_manager(tmp_path)
    client = _make_client(mgr)
    with patch.object(mgr, "push", new=AsyncMock(return_value={"pushed": 3})):
        r = client.post(
            "/api/v1/source-control/push",
            json={"message": "sync", "files": ["graphs/foo.json"]},
            headers=_AUTH,
        )
    assert r.status_code == 200
    assert r.json()["pushed"] == 3


def test_history(tmp_path: Path):
    mgr = _make_manager(tmp_path)
    client = _make_client(mgr)
    commits = [Commit(sha="abc", message="init", author="Alice", date="2024-01-01")]
    with patch.object(mgr, "get_history", new=AsyncMock(return_value=commits)):
        r = client.get("/api/v1/source-control/history?limit=10", headers=_AUTH)
    assert r.status_code == 200
    data = r.json()["commits"]
    assert len(data) == 1
    assert data[0]["sha"] == "abc"
