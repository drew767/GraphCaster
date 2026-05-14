# Copyright GraphCaster. All Rights Reserved.

"""Tests for the pause/resume REST API endpoint (F45)."""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any

import pytest

pytest.importorskip("starlette")

from starlette.testclient import TestClient

from graph_caster.pause_resume import CheckpointStore, PauseCheckpoint
from graph_caster.run_broker.registry import RunBrokerRegistry


def _make_client(tmp_path: Path, api_keys: str | None = None) -> TestClient:
    """Create a test Starlette client with optional API key auth."""
    import graph_caster.run_broker.routes.api_v1_routes as _routes_mod

    env_patch: dict[str, str] = {"GC_RUN_BROKER_ARTIFACTS_BASE": str(tmp_path)}
    if api_keys:
        env_patch["GC_RUN_BROKER_V1_API_KEYS"] = api_keys

    original_environ = dict(os.environ)
    os.environ.update(env_patch)
    try:
        from graph_caster.run_broker.app import create_app

        reg = RunBrokerRegistry()
        app = create_app(reg)
        client = TestClient(app, raise_server_exceptions=True)
    finally:
        os.environ.clear()
        os.environ.update(original_environ)

    return client, reg


def _save_checkpoint(tmp_path: Path, run_id: str, graph_id: str, node_id: str) -> None:
    store = CheckpointStore(tmp_path)
    cp = PauseCheckpoint(
        run_id=run_id,
        graph_id=graph_id,
        paused_at_node=node_id,
        node_outputs={"prev": {"nodeType": "start", "data": {}}},
        prompt="Do you approve?",
        kind="approval",
        choices=None,
        schema=None,
        paused_at="2026-05-12T10:00:00+00:00",
        timeout_sec=0.0,
    )
    asyncio.run(store.save(cp))


class TestResumeEndpointAuth:
    def test_resume_without_api_key_allowed_when_no_auth_configured(
        self, tmp_path: Path
    ) -> None:
        """Without GC_RUN_BROKER_V1_API_KEYS, resume accepts any request."""
        _save_checkpoint(tmp_path, "run-noauth", "g1", "hi1")

        import graph_caster.run_broker.routes.api_v1_routes as _mod
        import os as _os

        original = dict(_os.environ)
        _os.environ["GC_RUN_BROKER_ARTIFACTS_BASE"] = str(tmp_path)
        _os.environ["GC_RUN_BROKER_GRAPHS_DIR"] = str(tmp_path)
        try:
            from graph_caster.run_broker.app import create_app

            reg = RunBrokerRegistry()
            app = create_app(reg)
            client = TestClient(app, raise_server_exceptions=False)
            resp = client.post(
                "/api/v1/runs/run-noauth/resume",
                json={"nodeId": "hi1", "payload": True},
            )
        finally:
            _os.environ.clear()
            _os.environ.update(original)

        assert resp.status_code in (200, 404, 503)

    def test_resume_invalid_api_key_returns_403(self, tmp_path: Path) -> None:
        """With API keys configured, an invalid API key returns 403."""
        import os as _os

        original = dict(_os.environ)
        _os.environ["GC_RUN_BROKER_ARTIFACTS_BASE"] = str(tmp_path)
        _os.environ["GC_RUN_BROKER_V1_API_KEYS"] = "real-key:real-secret"
        _os.environ["GC_RUN_BROKER_GRAPHS_DIR"] = str(tmp_path)

        try:
            from graph_caster.run_broker.app import create_app
            from graph_caster.run_broker.registry import RunBrokerRegistry as _Reg

            reg = _Reg()
            app = create_app(reg)
            client = TestClient(app, raise_server_exceptions=False)

            resp = client.post(
                "/api/v1/runs/some-run/resume",
                headers={"Authorization": "Bearer wrong-key:wrong-secret"},
                json={"nodeId": "hi1", "payload": True},
            )
        finally:
            _os.environ.clear()
            _os.environ.update(original)

        assert resp.status_code == 403

    def test_resume_already_completed_returns_404(self, tmp_path: Path) -> None:
        """Resuming a run with no checkpoint returns 404."""
        import os as _os

        original = dict(_os.environ)
        _os.environ["GC_RUN_BROKER_ARTIFACTS_BASE"] = str(tmp_path)
        _os.environ["GC_RUN_BROKER_GRAPHS_DIR"] = str(tmp_path)
        try:
            from graph_caster.run_broker.app import create_app
            from graph_caster.run_broker.registry import RunBrokerRegistry as _Reg

            reg = _Reg()
            app = create_app(reg)
            client = TestClient(app, raise_server_exceptions=False)

            resp = client.post(
                "/api/v1/runs/completed-run-xyz/resume",
                json={"nodeId": "hi1", "payload": True},
            )
        finally:
            _os.environ.clear()
            _os.environ.update(original)

        assert resp.status_code == 404

    def test_resume_nodeid_mismatch_returns_400(self, tmp_path: Path) -> None:
        """If the provided nodeId doesn't match the paused node, return 400."""
        _save_checkpoint(tmp_path, "run-mismatch", "g1", "hi1")

        import os as _os

        original = dict(_os.environ)
        _os.environ["GC_RUN_BROKER_ARTIFACTS_BASE"] = str(tmp_path)
        _os.environ["GC_RUN_BROKER_GRAPHS_DIR"] = str(tmp_path)
        try:
            from graph_caster.run_broker.app import create_app
            from graph_caster.run_broker.registry import RunBrokerRegistry as _Reg

            reg = _Reg()
            app = create_app(reg)
            client = TestClient(app, raise_server_exceptions=False)

            resp = client.post(
                "/api/v1/runs/run-mismatch/resume",
                json={"nodeId": "wrong-node", "payload": True},
            )
        finally:
            _os.environ.clear()
            _os.environ.update(original)

        assert resp.status_code == 400


class TestPausedRunsList:
    def test_list_paused_runs_empty(self, tmp_path: Path) -> None:
        import os as _os

        original = dict(_os.environ)
        _os.environ["GC_RUN_BROKER_ARTIFACTS_BASE"] = str(tmp_path)
        try:
            from graph_caster.run_broker.app import create_app
            from graph_caster.run_broker.registry import RunBrokerRegistry as _Reg

            reg = _Reg()
            app = create_app(reg)
            client = TestClient(app, raise_server_exceptions=False)
            resp = client.get("/api/v1/runs/paused")
        finally:
            _os.environ.clear()
            _os.environ.update(original)

        assert resp.status_code == 200
        body = resp.json()
        assert "items" in body
        assert body["items"] == []

    def test_list_paused_runs_returns_saved_checkpoint(self, tmp_path: Path) -> None:
        _save_checkpoint(tmp_path, "run-listed", "g-listed", "hi-listed")

        import os as _os

        original = dict(_os.environ)
        _os.environ["GC_RUN_BROKER_ARTIFACTS_BASE"] = str(tmp_path)
        try:
            from graph_caster.run_broker.app import create_app
            from graph_caster.run_broker.registry import RunBrokerRegistry as _Reg

            reg = _Reg()
            app = create_app(reg)
            client = TestClient(app, raise_server_exceptions=False)
            resp = client.get("/api/v1/runs/paused")
        finally:
            _os.environ.clear()
            _os.environ.update(original)

        assert resp.status_code == 200
        body = resp.json()
        assert len(body["items"]) == 1
        item = body["items"][0]
        assert item["runId"] == "run-listed"
        assert item["pausedAtNode"] == "hi-listed"
        assert item["kind"] == "approval"
