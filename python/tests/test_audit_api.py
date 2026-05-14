# Copyright GraphCaster. All Rights Reserved.

"""Tests for F87: Audit log REST API — GET /api/v1/audit."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

pytest.importorskip("starlette")

from starlette.testclient import TestClient

from graph_caster.audit.audit_event import _reset_state, emit
from graph_caster.run_broker.app import create_app
from graph_caster.run_broker.auth.api_key import APIKeyAuthenticator
from graph_caster.run_broker.registry import RunBrokerRegistry


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _make_app_with_auth(key_id: str, secret: str, scopes: list[str]) -> "TestClient":
    """Build a TestClient for create_app() with an API key pre-registered via env."""
    return TestClient(create_app(registry=RunBrokerRegistry()), raise_server_exceptions=True)


@pytest.fixture()
def audit_log(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Create a populated audit JSONL and point GC_AUDIT_LOG_PATH at it."""
    log = tmp_path / "audit.jsonl"
    monkeypatch.setenv("GC_AUDIT_LOG_PATH", str(log))
    _reset_state()

    emit(action="graph.create", actor="alice", target_kind="graph", target_id="g1")
    emit(action="graph.publish", actor="alice", target_kind="graph", target_id="g1")
    emit(action="run.start", actor="system", actor_kind="system", target_kind="run", target_id="r1")
    emit(action="run.cancel", actor="bob", target_kind="run", target_id="r1")

    return log


@pytest.fixture()
def auth_env(monkeypatch: pytest.MonkeyPatch) -> tuple[str, str]:
    """Register an API key with audit:read scope via the env var."""
    key_id = "gc_test_audit"
    secret = "audit_secret_123"
    monkeypatch.setenv(
        "GC_RUN_BROKER_V1_API_KEYS",
        f"{key_id}:{secret}",
    )
    return key_id, secret


@pytest.fixture()
def client(audit_log: Path) -> TestClient:
    return TestClient(create_app(registry=RunBrokerRegistry()), raise_server_exceptions=True)


# ---------------------------------------------------------------------------
# Tests — happy path
# ---------------------------------------------------------------------------


def test_audit_no_auth_returns_all_events(
    client: TestClient,
    audit_log: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Without auth configured, audit:read is open."""
    # Clear the env var so no auth is required
    monkeypatch.delenv("GC_RUN_BROKER_V1_API_KEYS", raising=False)
    resp = client.get("/api/v1/audit")
    assert resp.status_code == 200
    body = resp.json()
    assert "events" in body
    assert len(body["events"]) == 4


def test_audit_with_valid_scope(
    audit_log: Path,
    auth_env: tuple[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    key_id, secret = auth_env
    c = TestClient(create_app(registry=RunBrokerRegistry()), raise_server_exceptions=True)
    resp = c.get(
        "/api/v1/audit",
        headers={"Authorization": f"Bearer {key_id}:{secret}"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["events"]) == 4
    assert body["cursor"] is None


def test_audit_without_scope_returns_403(
    audit_log: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Key registered without audit:read should get 403."""
    key_id = "gc_no_audit"
    secret = "no_audit_secret"
    # Register key without audit:read
    monkeypatch.setenv("GC_RUN_BROKER_V1_API_KEYS", f"{key_id}:{secret}")
    # Patch _load_api_v1_auth to return a key without audit:read
    from graph_caster.run_broker.auth.api_key import APIKeyAuthenticator
    from graph_caster.run_broker import routes as _routes_mod

    auth_no_audit = APIKeyAuthenticator()
    auth_no_audit.register_key(key_id, secret, "limited", ["run:view"])

    import graph_caster.run_broker.routes.api_v1_routes as _v1
    orig = _v1._load_api_v1_auth

    try:
        _v1._load_api_v1_auth = lambda: auth_no_audit  # type: ignore[assignment]
        c = TestClient(create_app(registry=RunBrokerRegistry()), raise_server_exceptions=True)
        resp = c.get(
            "/api/v1/audit",
            headers={"Authorization": f"Bearer {key_id}:{secret}"},
        )
        assert resp.status_code == 403
    finally:
        _v1._load_api_v1_auth = orig


def test_audit_invalid_key_returns_403(
    audit_log: Path,
    auth_env: tuple[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    key_id, _secret = auth_env
    c = TestClient(create_app(registry=RunBrokerRegistry()), raise_server_exceptions=True)
    resp = c.get(
        "/api/v1/audit",
        headers={"Authorization": f"Bearer {key_id}:WRONG_SECRET"},
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Tests — filters
# ---------------------------------------------------------------------------


def test_audit_filter_actor(
    audit_log: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("GC_RUN_BROKER_V1_API_KEYS", raising=False)
    c = TestClient(create_app(registry=RunBrokerRegistry()), raise_server_exceptions=True)
    resp = c.get("/api/v1/audit", params={"actor": "alice"})
    assert resp.status_code == 200
    events = resp.json()["events"]
    assert all(e["actor"] == "alice" for e in events)
    assert len(events) == 2


def test_audit_filter_action(
    audit_log: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("GC_RUN_BROKER_V1_API_KEYS", raising=False)
    c = TestClient(create_app(registry=RunBrokerRegistry()), raise_server_exceptions=True)
    resp = c.get("/api/v1/audit", params={"action": "run.start"})
    assert resp.status_code == 200
    events = resp.json()["events"]
    assert all(e["action"] == "run.start" for e in events)
    assert len(events) == 1


def test_audit_empty_log(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    log = tmp_path / "empty.jsonl"
    monkeypatch.setenv("GC_AUDIT_LOG_PATH", str(log))
    monkeypatch.delenv("GC_RUN_BROKER_V1_API_KEYS", raising=False)
    c = TestClient(create_app(registry=RunBrokerRegistry()), raise_server_exceptions=True)
    resp = c.get("/api/v1/audit")
    assert resp.status_code == 200
    assert resp.json() == {"events": [], "cursor": None}


def test_audit_no_log_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GC_AUDIT_LOG_PATH", raising=False)
    monkeypatch.delenv("GC_RUN_BROKER_V1_API_KEYS", raising=False)
    c = TestClient(create_app(registry=RunBrokerRegistry()), raise_server_exceptions=True)
    resp = c.get("/api/v1/audit")
    assert resp.status_code == 200
    assert resp.json() == {"events": [], "cursor": None}


# ---------------------------------------------------------------------------
# Tests — cursor pagination
# ---------------------------------------------------------------------------


def test_audit_cursor_pagination(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    log = tmp_path / "audit.jsonl"
    monkeypatch.setenv("GC_AUDIT_LOG_PATH", str(log))
    monkeypatch.delenv("GC_RUN_BROKER_V1_API_KEYS", raising=False)
    _reset_state()

    for i in range(7):
        emit(action="graph.create", actor=f"user-{i}", target_kind="graph", target_id=f"g{i}")

    c = TestClient(create_app(registry=RunBrokerRegistry()), raise_server_exceptions=True)

    resp1 = c.get("/api/v1/audit", params={"limit": 3})
    assert resp1.status_code == 200
    body1 = resp1.json()
    assert len(body1["events"]) == 3
    cursor1 = body1["cursor"]
    assert cursor1 is not None

    resp2 = c.get("/api/v1/audit", params={"limit": 3, "cursor": cursor1})
    body2 = resp2.json()
    assert len(body2["events"]) == 3
    cursor2 = body2["cursor"]
    assert cursor2 is not None

    resp3 = c.get("/api/v1/audit", params={"limit": 3, "cursor": cursor2})
    body3 = resp3.json()
    assert len(body3["events"]) == 1
    assert body3["cursor"] is None

    # No overlap
    ids1 = {e["id"] for e in body1["events"]}
    ids2 = {e["id"] for e in body2["events"]}
    ids3 = {e["id"] for e in body3["events"]}
    assert ids1.isdisjoint(ids2)
    assert ids2.isdisjoint(ids3)
    assert len(ids1 | ids2 | ids3) == 7


# ---------------------------------------------------------------------------
# Test — event schema shape
# ---------------------------------------------------------------------------


def test_audit_event_schema(audit_log: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GC_RUN_BROKER_V1_API_KEYS", raising=False)
    c = TestClient(create_app(registry=RunBrokerRegistry()), raise_server_exceptions=True)
    resp = c.get("/api/v1/audit")
    events = resp.json()["events"]
    required_fields = {
        "id", "timestamp", "actor", "actor_kind", "tenant_id",
        "action", "target_kind", "target_id", "result",
        "metadata", "prev_hash", "entry_hash",
    }
    for ev in events:
        missing = required_fields - ev.keys()
        assert not missing, f"Event missing fields: {missing}"
