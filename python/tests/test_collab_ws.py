# Copyright GraphCaster. All Rights Reserved.

"""Tests for F77 collab WebSocket endpoint."""

from __future__ import annotations

import asyncio
import base64
import json
import os

import pytest
from starlette.applications import Starlette
from starlette.routing import WebSocketRoute
from starlette.testclient import TestClient

from graph_caster.run_broker.collab_ws import (
    _SESSIONS,
    WS_CLOSE_BAD_HELLO,
    WS_CLOSE_FEATURE_DISABLED,
    collab_websocket,
)


def _make_app() -> Starlette:
    return Starlette(
        routes=[WebSocketRoute("/api/v1/collab/{graph_id}/ws", collab_websocket)],
    )


@pytest.fixture(autouse=True)
def _clean_sessions():
    _SESSIONS.clear()
    yield
    _SESSIONS.clear()


@pytest.fixture(autouse=True)
def _enable_collab(monkeypatch):
    monkeypatch.setenv("GC_RUN_BROKER_COLLAB", "on")


class TestFeatureGate:
    def test_disabled_by_default(self, monkeypatch):
        monkeypatch.delenv("GC_RUN_BROKER_COLLAB", raising=False)
        app = _make_app()
        client = TestClient(app, raise_server_exceptions=False)
        with client.websocket_connect("/api/v1/collab/g1/ws") as ws:
            data = ws.receive()
            assert data.get("code") == WS_CLOSE_FEATURE_DISABLED or data.get("type") == "websocket.close"

    def test_enabled(self):
        app = _make_app()
        client = TestClient(app)
        with client.websocket_connect("/api/v1/collab/testgraph/ws") as ws:
            ws.send_text(json.dumps({"type": "hello", "graphId": "testgraph", "token": ""}))
            msg = json.loads(ws.receive_text())
            assert msg["type"] == "sync-snapshot"


class TestHello:
    def test_missing_graphId_closes(self):
        app = _make_app()
        client = TestClient(app, raise_server_exceptions=False)
        with client.websocket_connect("/api/v1/collab/g1/ws") as ws:
            ws.send_text(json.dumps({"type": "hello"}))
            data = ws.receive()
            assert data.get("code") == WS_CLOSE_BAD_HELLO or data.get("type") == "websocket.close"

    def test_wrong_type_closes(self):
        app = _make_app()
        client = TestClient(app, raise_server_exceptions=False)
        with client.websocket_connect("/api/v1/collab/g1/ws") as ws:
            ws.send_text(json.dumps({"type": "other", "graphId": "g1"}))
            data = ws.receive()
            assert data.get("type") == "websocket.close"

    def test_invalid_json_closes(self):
        app = _make_app()
        client = TestClient(app, raise_server_exceptions=False)
        with client.websocket_connect("/api/v1/collab/g1/ws") as ws:
            ws.send_text("not-json")
            data = ws.receive()
            assert data.get("type") == "websocket.close"


class TestSyncSnapshot:
    def test_empty_snapshot_on_first_connect(self):
        app = _make_app()
        client = TestClient(app)
        with client.websocket_connect("/api/v1/collab/newgraph/ws") as ws:
            ws.send_text(json.dumps({"type": "hello", "graphId": "newgraph", "token": ""}))
            msg = json.loads(ws.receive_text())
            assert msg["type"] == "sync-snapshot"
            assert msg["data"] == ""

    def test_snapshot_includes_prior_state(self):
        payload = b"fake-yjs-update"
        payload_b64 = base64.b64encode(payload).decode()

        app = _make_app()
        client = TestClient(app)

        with client.websocket_connect("/api/v1/collab/shared/ws") as ws_a:
            ws_a.send_text(json.dumps({"type": "hello", "graphId": "shared", "token": ""}))
            snap = json.loads(ws_a.receive_text())
            assert snap["type"] == "sync-snapshot"

            ws_a.send_text(json.dumps({"type": "update", "data": payload_b64}))
            ws_a.send_text(json.dumps({"type": "bye"}))

        with client.websocket_connect("/api/v1/collab/shared/ws") as ws_b:
            ws_b.send_text(json.dumps({"type": "hello", "graphId": "shared", "token": ""}))
            snap2 = json.loads(ws_b.receive_text())
            assert snap2["type"] == "sync-snapshot"
            state = base64.b64decode(snap2["data"])
            assert payload in state


class TestUpdateRelay:
    def test_client_a_update_reaches_client_b(self):
        """Client A sends update -> Client B receives it; Client A does NOT receive echo."""
        payload = b"yjs-update-bytes"
        payload_b64 = base64.b64encode(payload).decode()

        app = _make_app()

        received_by_b: list[dict] = []

        def run_scenario():
            with TestClient(app) as client:
                with client.websocket_connect("/api/v1/collab/relay-test/ws") as ws_a:
                    ws_a.send_text(
                        json.dumps({"type": "hello", "graphId": "relay-test", "token": ""})
                    )
                    json.loads(ws_a.receive_text())

                    with client.websocket_connect("/api/v1/collab/relay-test/ws") as ws_b:
                        ws_b.send_text(
                            json.dumps({"type": "hello", "graphId": "relay-test", "token": ""})
                        )
                        json.loads(ws_b.receive_text())

                        ws_a.send_text(json.dumps({"type": "update", "data": payload_b64}))

                        msg = json.loads(ws_b.receive_text())
                        received_by_b.append(msg)

        run_scenario()

        assert len(received_by_b) == 1
        msg = received_by_b[0]
        assert msg["type"] == "update"
        assert base64.b64decode(msg["data"]) == payload

    def test_update_not_echoed_to_sender(self):
        payload_b64 = base64.b64encode(b"abc").decode()
        app = _make_app()

        with TestClient(app) as client:
            with client.websocket_connect("/api/v1/collab/echo-test/ws") as ws_a:
                ws_a.send_text(json.dumps({"type": "hello", "graphId": "echo-test", "token": ""}))
                json.loads(ws_a.receive_text())

                ws_a.send_text(json.dumps({"type": "update", "data": payload_b64}))
                ws_a.send_text(json.dumps({"type": "ping-sentinel"}))

                msg = json.loads(ws_a.receive_text())
                assert msg.get("type") != "update", "sender must not receive its own update"


class TestAwarenessRelay:
    def test_awareness_relayed_not_echoed(self):
        payload = b"awareness-bytes"
        payload_b64 = base64.b64encode(payload).decode()

        app = _make_app()
        received_b: list[dict] = []

        with TestClient(app) as client:
            with client.websocket_connect("/api/v1/collab/aw-test/ws") as ws_a:
                ws_a.send_text(
                    json.dumps({"type": "hello", "graphId": "aw-test", "token": ""})
                )
                json.loads(ws_a.receive_text())

                with client.websocket_connect("/api/v1/collab/aw-test/ws") as ws_b:
                    ws_b.send_text(
                        json.dumps({"type": "hello", "graphId": "aw-test", "token": ""})
                    )
                    json.loads(ws_b.receive_text())

                    ws_a.send_text(json.dumps({"type": "awareness", "data": payload_b64}))

                    msg = json.loads(ws_b.receive_text())
                    received_b.append(msg)

        assert len(received_b) == 1
        assert received_b[0]["type"] == "awareness"
        assert base64.b64decode(received_b[0]["data"]) == payload


class TestDisconnectCleanup:
    def test_session_cleaned_on_disconnect(self):
        app = _make_app()
        graph_id = "cleanup-graph"

        with TestClient(app) as client:
            with client.websocket_connect(f"/api/v1/collab/{graph_id}/ws") as ws:
                ws.send_text(json.dumps({"type": "hello", "graphId": graph_id, "token": ""}))
                json.loads(ws.receive_text())
                assert graph_id in _SESSIONS
                session = _SESSIONS[graph_id]
                assert len(session._connections) == 1

        assert graph_id in _SESSIONS
        assert len(_SESSIONS[graph_id]._connections) == 0
