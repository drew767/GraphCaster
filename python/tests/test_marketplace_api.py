# Copyright GraphCaster. All Rights Reserved.

"""Tests for marketplace REST API endpoints (F78)."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

pytest.importorskip("starlette")

from starlette.testclient import TestClient

from graph_caster.run_broker.app import create_app
from graph_caster.run_broker.auth.api_key import APIKeyAuthenticator
from graph_caster.run_broker.registry import RunBrokerRegistry


# ---------------------------------------------------------------------------
# Sample template documents (same structure as test_marketplace.py)
# ---------------------------------------------------------------------------

HELLO_DOC = {
    "schemaVersion": 1,
    "meta": {
        "graphId": "hello-world",
        "title": "Hello World",
        "description": "Minimal starter graph.",
        "marketplace": {
            "badge": "Starter",
            "frameworks": [],
            "usecases": ["Demo", "Learning"],
            "author": "GraphCaster Team",
            "tags": ["starter", "hello-world"],
            "preview_image": "/static/marketplace/hello-world.png",
        },
    },
    "nodes": [
        {"id": "s1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
        {"id": "x1", "type": "exit", "position": {"x": 200, "y": 0}, "data": {}},
    ],
    "edges": [
        {
            "id": "e1",
            "source": "s1",
            "sourceHandle": "out_default",
            "target": "x1",
            "targetHandle": "in_default",
            "condition": None,
        }
    ],
}

LLM_DOC = {
    "schemaVersion": 1,
    "meta": {
        "graphId": "llm-summarize",
        "title": "LLM Summarizer",
        "description": "Summarize text using an LLM node.",
        "marketplace": {
            "badge": "Popular",
            "frameworks": ["LangChain"],
            "usecases": ["Summarization", "NLP"],
            "author": "GraphCaster Team",
            "tags": ["llm", "summarization"],
            "preview_image": None,
        },
    },
    "nodes": [
        {"id": "s1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
        {"id": "x1", "type": "exit", "position": {"x": 200, "y": 0}, "data": {}},
    ],
    "edges": [],
}


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def marketplace_dir(tmp_path: Path) -> Path:
    d = tmp_path / "marketplace"
    d.mkdir()
    (d / "hello-world.json").write_text(json.dumps(HELLO_DOC), encoding="utf-8")
    (d / "llm-summarize.json").write_text(json.dumps(LLM_DOC), encoding="utf-8")
    return d


@pytest.fixture()
def graphs_dir(tmp_path: Path, marketplace_dir: Path) -> Path:
    d = tmp_path / "graphs"
    d.mkdir()
    return d


def _make_client(
    marketplace_dir: Path,
    graphs_dir: Path,
    api_key: str | None = None,
    monkeypatch: pytest.MonkeyPatch | None = None,
) -> TestClient:
    """Create a TestClient with marketplace env vars set."""
    reg = RunBrokerRegistry()
    app = create_app(reg)
    env_patch = {
        "GC_MARKETPLACE_DIR": str(marketplace_dir),
        "GC_RUN_BROKER_GRAPHS_DIR": str(graphs_dir),
    }
    if api_key is not None:
        env_patch["GC_RUN_BROKER_V1_API_KEYS"] = f"gc_test:{api_key}"
    for k, v in env_patch.items():
        os.environ[k] = v
    client = TestClient(app, raise_server_exceptions=True)
    return client


@pytest.fixture()
def client(marketplace_dir: Path, graphs_dir: Path) -> TestClient:
    old_mp = os.environ.get("GC_MARKETPLACE_DIR")
    old_gd = os.environ.get("GC_RUN_BROKER_GRAPHS_DIR")
    os.environ["GC_MARKETPLACE_DIR"] = str(marketplace_dir)
    os.environ["GC_RUN_BROKER_GRAPHS_DIR"] = str(graphs_dir)
    reg = RunBrokerRegistry()
    app = create_app(reg)
    c = TestClient(app, raise_server_exceptions=True)
    yield c
    if old_mp is not None:
        os.environ["GC_MARKETPLACE_DIR"] = old_mp
    else:
        os.environ.pop("GC_MARKETPLACE_DIR", None)
    if old_gd is not None:
        os.environ["GC_RUN_BROKER_GRAPHS_DIR"] = old_gd
    else:
        os.environ.pop("GC_RUN_BROKER_GRAPHS_DIR", None)


# ---------------------------------------------------------------------------
# GET /api/v1/marketplace
# ---------------------------------------------------------------------------


def test_list_marketplace_ok(client: TestClient) -> None:
    r = client.get("/api/v1/marketplace")
    assert r.status_code == 200
    body = r.json()
    assert body["configured"] is True
    assert len(body["items"]) == 2
    ids = {item["id"] for item in body["items"]}
    assert ids == {"hello-world", "llm-summarize"}


def test_list_marketplace_filter_framework(client: TestClient) -> None:
    r = client.get("/api/v1/marketplace?framework=LangChain")
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) == 1
    assert items[0]["id"] == "llm-summarize"


def test_list_marketplace_filter_usecase(client: TestClient) -> None:
    r = client.get("/api/v1/marketplace?usecase=Demo")
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) == 1
    assert items[0]["id"] == "hello-world"


def test_list_marketplace_filter_tag(client: TestClient) -> None:
    r = client.get("/api/v1/marketplace?tag=starter")
    assert r.status_code == 200
    items = r.json()["items"]
    assert len(items) == 1
    assert items[0]["id"] == "hello-world"


def test_list_marketplace_no_match(client: TestClient) -> None:
    r = client.get("/api/v1/marketplace?framework=Pinecone")
    assert r.status_code == 200
    assert r.json()["items"] == []


def test_list_marketplace_not_configured() -> None:
    old = os.environ.pop("GC_MARKETPLACE_DIR", None)
    old_gd = os.environ.pop("GC_RUN_BROKER_GRAPHS_DIR", None)
    try:
        reg = RunBrokerRegistry()
        app = create_app(reg)
        c = TestClient(app, raise_server_exceptions=True)
        r = c.get("/api/v1/marketplace")
        assert r.status_code == 200
        assert r.json()["configured"] is False
        assert r.json()["items"] == []
    finally:
        if old is not None:
            os.environ["GC_MARKETPLACE_DIR"] = old
        if old_gd is not None:
            os.environ["GC_RUN_BROKER_GRAPHS_DIR"] = old_gd


# ---------------------------------------------------------------------------
# GET /api/v1/marketplace/{templateId}
# ---------------------------------------------------------------------------


def test_get_template_ok(client: TestClient) -> None:
    r = client.get("/api/v1/marketplace/hello-world")
    assert r.status_code == 200
    doc = r.json()
    assert doc["meta"]["graphId"] == "hello-world"
    assert "nodes" in doc


def test_get_template_not_found(client: TestClient) -> None:
    r = client.get("/api/v1/marketplace/does-not-exist")
    assert r.status_code == 404


def test_get_template_both_available(client: TestClient) -> None:
    for tid in ("hello-world", "llm-summarize"):
        r = client.get(f"/api/v1/marketplace/{tid}")
        assert r.status_code == 200


# ---------------------------------------------------------------------------
# POST /api/v1/marketplace/{templateId}/instantiate — no auth configured
# ---------------------------------------------------------------------------


def test_instantiate_ok_no_auth(client: TestClient, graphs_dir: Path) -> None:
    r = client.post(
        "/api/v1/marketplace/hello-world/instantiate",
        json={"graph_id": "my-first-graph"},
    )
    assert r.status_code == 201
    body = r.json()
    assert body["graphId"] == "my-first-graph"
    dest = graphs_dir / "my-first-graph.json"
    assert dest.exists()
    doc = json.loads(dest.read_text(encoding="utf-8"))
    assert doc["meta"]["graphId"] == "my-first-graph"


def test_instantiate_missing_graph_id(client: TestClient) -> None:
    r = client.post(
        "/api/v1/marketplace/hello-world/instantiate",
        json={},
    )
    assert r.status_code == 400


def test_instantiate_template_not_found(client: TestClient) -> None:
    r = client.post(
        "/api/v1/marketplace/no-such-template/instantiate",
        json={"graph_id": "test"},
    )
    assert r.status_code == 404


def test_instantiate_invalid_graph_id(client: TestClient) -> None:
    r = client.post(
        "/api/v1/marketplace/hello-world/instantiate",
        json={"graph_id": "../escape"},
    )
    assert r.status_code == 400


# ---------------------------------------------------------------------------
# POST /api/v1/marketplace/{templateId}/instantiate — with auth
# ---------------------------------------------------------------------------


def _make_authed_client(marketplace_dir: Path, graphs_dir: Path) -> tuple[TestClient, str]:
    """Returns (client, bearer_header) with graph:edit scope."""
    key_id, secret = "gc_testkey", "testsecret123"
    old_mp = os.environ.get("GC_MARKETPLACE_DIR")
    old_gd = os.environ.get("GC_RUN_BROKER_GRAPHS_DIR")
    old_keys = os.environ.get("GC_RUN_BROKER_V1_API_KEYS")
    os.environ["GC_MARKETPLACE_DIR"] = str(marketplace_dir)
    os.environ["GC_RUN_BROKER_GRAPHS_DIR"] = str(graphs_dir)
    os.environ["GC_RUN_BROKER_V1_API_KEYS"] = f"{key_id}:{secret}"
    reg = RunBrokerRegistry()
    app = create_app(reg)
    client = TestClient(app, raise_server_exceptions=True)
    return client, f"Bearer {key_id}:{secret}"


def test_instantiate_requires_scope_when_auth_configured(
    marketplace_dir: Path, graphs_dir: Path
) -> None:
    key_id = "gc_testkey2"
    secret = "testsecret456"
    old_mp = os.environ.get("GC_MARKETPLACE_DIR")
    old_gd = os.environ.get("GC_RUN_BROKER_GRAPHS_DIR")
    old_keys = os.environ.get("GC_RUN_BROKER_V1_API_KEYS")
    os.environ["GC_MARKETPLACE_DIR"] = str(marketplace_dir)
    os.environ["GC_RUN_BROKER_GRAPHS_DIR"] = str(graphs_dir)
    os.environ["GC_RUN_BROKER_V1_API_KEYS"] = f"{key_id}:{secret}"
    try:
        reg = RunBrokerRegistry()
        app = create_app(reg)
        c = TestClient(app, raise_server_exceptions=True)
        # No auth header — should be 403
        r = c.post(
            "/api/v1/marketplace/hello-world/instantiate",
            json={"graph_id": "scoped-graph"},
        )
        assert r.status_code == 403
        # Valid key — should succeed
        r2 = c.post(
            "/api/v1/marketplace/hello-world/instantiate",
            json={"graph_id": "scoped-graph"},
            headers={"Authorization": f"Bearer {key_id}:{secret}"},
        )
        assert r2.status_code == 201
    finally:
        if old_mp is not None:
            os.environ["GC_MARKETPLACE_DIR"] = old_mp
        else:
            os.environ.pop("GC_MARKETPLACE_DIR", None)
        if old_gd is not None:
            os.environ["GC_RUN_BROKER_GRAPHS_DIR"] = old_gd
        else:
            os.environ.pop("GC_RUN_BROKER_GRAPHS_DIR", None)
        if old_keys is not None:
            os.environ["GC_RUN_BROKER_V1_API_KEYS"] = old_keys
        else:
            os.environ.pop("GC_RUN_BROKER_V1_API_KEYS", None)
