# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import pytest

pytest.importorskip("starlette")

from starlette.testclient import TestClient

from graph_caster.run_broker.app import create_app
from graph_caster.run_broker.registry import RunBrokerRegistry


def _make_client() -> TestClient:
    reg = RunBrokerRegistry()
    return TestClient(create_app(reg))


def test_config_returns_200() -> None:
    client = _make_client()
    r = client.get("/api/v1/config")
    assert r.status_code == 200


def test_config_shape() -> None:
    client = _make_client()
    r = client.get("/api/v1/config")
    body = r.json()
    assert "publicUrl" in body
    assert "version" in body
    assert "features" in body
    features = body["features"]
    assert isinstance(features, dict)
    for key in ("scheduler", "fsWatcher", "poller", "redisBus", "collab"):
        assert key in features, f"missing feature key: {key}"
        assert isinstance(features[key], bool), f"feature {key} must be bool"


def test_config_public_url_default_empty() -> None:
    client = _make_client()
    r = client.get("/api/v1/config")
    body = r.json()
    assert body["publicUrl"] == ""


def test_config_public_url_reflects_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_RUN_BROKER_PUBLIC_URL", "https://example.com")
    client = _make_client()
    r = client.get("/api/v1/config")
    body = r.json()
    assert body["publicUrl"] == "https://example.com"


def test_config_public_url_stripped(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_RUN_BROKER_PUBLIC_URL", "  https://example.com  ")
    client = _make_client()
    r = client.get("/api/v1/config")
    body = r.json()
    assert body["publicUrl"] == "https://example.com"


def test_config_features_scheduler_off_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GC_RUN_BROKER_SCHEDULER", raising=False)
    client = _make_client()
    r = client.get("/api/v1/config")
    body = r.json()
    assert body["features"]["scheduler"] is False


def test_config_version_is_string() -> None:
    client = _make_client()
    r = client.get("/api/v1/config")
    body = r.json()
    assert isinstance(body["version"], str)


def test_config_no_auth_required() -> None:
    """Config endpoint must be accessible without any Authorization header."""
    client = _make_client()
    r = client.get("/api/v1/config")
    assert r.status_code == 200
    assert "error" not in r.json()
