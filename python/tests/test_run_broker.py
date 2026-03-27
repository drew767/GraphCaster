# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import asyncio
import json

import pytest

pytest.importorskip("starlette")

from starlette.testclient import TestClient

from graph_caster.run_broker.app import create_app
from graph_caster.run_broker.registry import RunBrokerRegistry


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


def test_run_broker_health() -> None:
    reg = RunBrokerRegistry()
    client = TestClient(create_app(reg))
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_run_broker_stream_minimal_graph() -> None:
    reg = RunBrokerRegistry()
    client = TestClient(create_app(reg))
    gid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    payload = {
        "documentJson": json.dumps(_minimal_valid_doc(gid)),
        "runId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    }
    r = client.post("/runs", json=payload)
    assert r.status_code == 200, r.text
    rid = r.json()["runId"]
    assert rid == payload["runId"]

    buf = ""
    with client.stream("GET", f"/runs/{rid}/stream") as response:
        assert response.status_code == 200
        for chunk in response.iter_text():
            buf += chunk
            if "run_finished" in buf:
                break

    assert "run_started" in buf
    assert "run_success" in buf or '"type":"run_success"' in buf
    assert "run_finished" in buf


def test_run_broker_rejects_duplicate_active_run_id() -> None:
    reg = RunBrokerRegistry()
    client = TestClient(create_app(reg))
    gid = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    doc = json.dumps(_minimal_valid_doc(gid))
    rid = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
    r1 = client.post("/runs", json={"documentJson": doc, "runId": rid})
    assert r1.status_code == 200
    r2 = client.post("/runs", json={"documentJson": doc, "runId": rid})
    assert r2.status_code == 400

    buf = ""
    with client.stream("GET", f"/runs/{rid}/stream") as response:
        for chunk in response.iter_text():
            buf += chunk
            if "exit" in buf:
                break


def test_run_broker_unknown_stream_404() -> None:
    reg = RunBrokerRegistry()
    client = TestClient(create_app(reg))
    r = client.get("/runs/no-such-id/stream")
    assert r.status_code == 404


def test_run_broker_token_accepts_header_or_query(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_RUN_BROKER_TOKEN", "sekrit")
    reg = RunBrokerRegistry()
    client = TestClient(create_app(reg))
    assert client.get("/health").status_code == 401
    assert client.get("/health", params={"token": "wrong"}).status_code == 401
    assert client.get("/health", params={"token": "sekrit"}).status_code == 200
    assert client.get("/health", headers={"X-GC-Dev-Token": "sekrit"}).status_code == 200


def test_run_broker_stream_accepts_token_query(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_RUN_BROKER_TOKEN", "tok")
    reg = RunBrokerRegistry()
    client = TestClient(create_app(reg))
    gid = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
    payload = {
        "documentJson": json.dumps(_minimal_valid_doc(gid)),
        "runId": "ffffffff-ffff-4fff-8fff-ffffffffffff",
    }
    r = client.post("/runs", json=payload, headers={"X-GC-Dev-Token": "tok"})
    assert r.status_code == 200, r.text
    rid = r.json()["runId"]
    assert client.get(f"/runs/{rid}/stream").status_code == 401
    buf = ""
    with client.stream("GET", f"/runs/{rid}/stream", params={"token": "tok"}) as response:
        assert response.status_code == 200
        for chunk in response.iter_text():
            buf += chunk
            if "run_finished" in buf:
                break
    assert "run_started" in buf


def test_broadcaster_splits_newlines_in_sse_out() -> None:
    from graph_caster.run_broker.broadcaster import FanOutMsg, RunBroadcaster

    b = RunBroadcaster()
    q = b.subscribe()

    async def collect() -> str:
        parts: list[str] = []
        async for chunk in b.stream_queue(q):
            parts.append(chunk)
        return "".join(parts)

    b.broadcast(FanOutMsg("out", "a\nb"))
    b.broadcast(FanOutMsg("exit", 0))
    joined = asyncio.run(collect())
    assert "data: a\n" in joined
    assert "data: b\n" in joined
    assert "event: exit\n" in joined
