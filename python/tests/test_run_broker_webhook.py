# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import hashlib
import hmac
import json

import pytest

pytest.importorskip("starlette")

from starlette.testclient import TestClient

from graph_caster.run_broker.app import create_app
from graph_caster.run_broker.registry import RunBrokerRegistry


def _sign(secret: str, body: bytes) -> str:
    mac = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return f"sha256={mac}"


def _minimal_valid_doc(graph_id: str) -> dict:
    return {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": graph_id, "title": "x"},
        "viewport": {"x": 0, "y": 0, "zoom": 1},
        "nodes": [
            {"id": "s", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {"id": "x", "type": "exit", "position": {"x": 0, "y": 0}, "data": {}},
        ],
        "edges": [
            {
                "id": "e",
                "source": "s",
                "sourceHandle": "out_default",
                "target": "x",
                "targetHandle": "in_default",
                "condition": None,
            }
        ],
    }


def test_webhook_not_configured_returns_404(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GC_RUN_BROKER_WEBHOOK_SECRET", raising=False)
    reg = RunBrokerRegistry()
    client = TestClient(create_app(reg))
    body = b"{}"
    r = client.post("/webhooks/run", content=body, headers={"X-GC-Webhook-Signature": _sign("x", body)})
    assert r.status_code == 404
    assert r.json() == {"error": "webhook_not_configured"}


def test_webhook_invalid_signature_returns_401(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_RUN_BROKER_WEBHOOK_SECRET", "whsec_test")
    reg = RunBrokerRegistry()
    client = TestClient(create_app(reg))
    gid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    payload = {"documentJson": json.dumps(_minimal_valid_doc(gid)), "runId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}
    raw = json.dumps(payload).encode("utf-8")
    r = client.post(
        "/webhooks/run",
        content=raw,
        headers={"X-GC-Webhook-Signature": "sha256=" + "0" * 64},
    )
    assert r.status_code == 401
    assert r.json() == {"error": "invalid_signature"}


def test_webhook_missing_signature_returns_401(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_RUN_BROKER_WEBHOOK_SECRET", "whsec_test")
    reg = RunBrokerRegistry()
    client = TestClient(create_app(reg))
    gid = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    payload = {"documentJson": json.dumps(_minimal_valid_doc(gid)), "runId": "dddddddd-dddd-4ddd-8ddd-dddddddddddd"}
    raw = json.dumps(payload).encode("utf-8")
    r = client.post("/webhooks/run", content=raw)
    assert r.status_code == 401


def test_webhook_valid_signature_and_body_returns_200(monkeypatch: pytest.MonkeyPatch) -> None:
    secret = "whsec_ok"
    monkeypatch.setenv("GC_RUN_BROKER_WEBHOOK_SECRET", secret)
    reg = RunBrokerRegistry()
    client = TestClient(create_app(reg))
    gid = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
    payload = {"documentJson": json.dumps(_minimal_valid_doc(gid)), "runId": "ffffffff-ffff-4fff-8fff-ffffffffffff"}
    raw = json.dumps(payload).encode("utf-8")
    r = client.post(
        "/webhooks/run",
        content=raw,
        headers={"X-GC-Webhook-Signature": _sign(secret, raw)},
    )
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["runId"] == payload["runId"]
    assert isinstance(j.get("viewerToken"), str) and len(j["viewerToken"]) >= 8


def test_webhook_valid_signature_invalid_json_returns_400(monkeypatch: pytest.MonkeyPatch) -> None:
    secret = "whsec_badjson"
    monkeypatch.setenv("GC_RUN_BROKER_WEBHOOK_SECRET", secret)
    reg = RunBrokerRegistry()
    client = TestClient(create_app(reg))
    raw = b"{not json"
    r = client.post(
        "/webhooks/run",
        content=raw,
        headers={"X-GC-Webhook-Signature": _sign(secret, raw)},
    )
    assert r.status_code == 400
    assert "invalid json" in (r.json().get("error") or "").lower()


def test_webhook_idempotency_returns_same_run_id(monkeypatch: pytest.MonkeyPatch) -> None:
    secret = "whsec_idem"
    monkeypatch.setenv("GC_RUN_BROKER_WEBHOOK_SECRET", secret)
    reg = RunBrokerRegistry()
    client = TestClient(create_app(reg))
    gid = "11111111-1111-4111-8111-111111111111"
    payload = {"documentJson": json.dumps(_minimal_valid_doc(gid)), "runId": "22222222-2222-4222-8222-222222222222"}
    raw = json.dumps(payload).encode("utf-8")
    headers = {
        "X-GC-Webhook-Signature": _sign(secret, raw),
        "X-GC-Idempotency-Key": "idem-key-1",
    }
    r1 = client.post("/webhooks/run", content=raw, headers=headers)
    assert r1.status_code == 200, r1.text
    j1 = r1.json()
    r2 = client.post("/webhooks/run", content=raw, headers=headers)
    assert r2.status_code == 200, r2.text
    j2 = r2.json()
    assert j1["runId"] == j2["runId"]
    assert j1["viewerToken"] == j2["viewerToken"]
    assert j1.get("runBroker") == j2.get("runBroker")
    assert j1.get("runBroker", {}).get("phase") == "running"


def test_webhook_bypasses_broker_dev_token(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_RUN_BROKER_TOKEN", "dev_only")
    monkeypatch.setenv("GC_RUN_BROKER_WEBHOOK_SECRET", "whsec_bypass")
    reg = RunBrokerRegistry()
    client = TestClient(create_app(reg))
    gid = "33333333-3333-4333-8333-333333333333"
    payload = {"documentJson": json.dumps(_minimal_valid_doc(gid)), "runId": "44444444-4444-4444-8444-444444444444"}
    raw = json.dumps(payload).encode("utf-8")
    r = client.post(
        "/webhooks/run",
        content=raw,
        headers={"X-GC-Webhook-Signature": _sign("whsec_bypass", raw)},
    )
    assert r.status_code == 200, r.text
    assert r.json()["runId"] == payload["runId"]


def test_webhook_invalid_idempotency_too_long_returns_400(monkeypatch: pytest.MonkeyPatch) -> None:
    secret = "whsec_long"
    monkeypatch.setenv("GC_RUN_BROKER_WEBHOOK_SECRET", secret)
    reg = RunBrokerRegistry()
    client = TestClient(create_app(reg))
    gid = "99999999-9999-4999-8999-999999999999"
    payload = {"documentJson": json.dumps(_minimal_valid_doc(gid)), "runId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}
    raw = json.dumps(payload).encode("utf-8")
    long_key = "k" * 257
    r = client.post(
        "/webhooks/run",
        content=raw,
        headers={
            "X-GC-Webhook-Signature": _sign(secret, raw),
            "X-GC-Idempotency-Key": long_key,
        },
    )
    assert r.status_code == 400
    assert r.json().get("error") == "invalid_idempotency_key"


def test_webhook_invalid_idempotency_empty_returns_400(monkeypatch: pytest.MonkeyPatch) -> None:
    secret = "whsec_idem_bad"
    monkeypatch.setenv("GC_RUN_BROKER_WEBHOOK_SECRET", secret)
    reg = RunBrokerRegistry()
    client = TestClient(create_app(reg))
    gid = "55555555-5555-4555-8555-555555555555"
    payload = {"documentJson": json.dumps(_minimal_valid_doc(gid)), "runId": "66666666-6666-4666-8666-666666666666"}
    raw = json.dumps(payload).encode("utf-8")
    r = client.post(
        "/webhooks/run",
        content=raw,
        headers={
            "X-GC-Webhook-Signature": _sign(secret, raw),
            "X-GC-Idempotency-Key": "   ",
        },
    )
    assert r.status_code == 400
    assert r.json().get("error") == "invalid_idempotency_key"


def test_webhook_signature_case_insensitive_prefix(monkeypatch: pytest.MonkeyPatch) -> None:
    secret = "whsec_ci"
    monkeypatch.setenv("GC_RUN_BROKER_WEBHOOK_SECRET", secret)
    reg = RunBrokerRegistry()
    client = TestClient(create_app(reg))
    gid = "77777777-7777-4777-8777-777777777777"
    payload = {"documentJson": json.dumps(_minimal_valid_doc(gid)), "runId": "88888888-8888-4888-8888-888888888888"}
    raw = json.dumps(payload).encode("utf-8")
    sig = _sign(secret, raw)
    alt = "SHA256=" + sig.split("=", 1)[1]
    r = client.post("/webhooks/run", content=raw, headers={"X-GC-Webhook-Signature": alt})
    assert r.status_code == 200, r.text
