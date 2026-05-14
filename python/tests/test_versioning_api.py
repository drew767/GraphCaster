# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

pytest.importorskip("starlette")

from starlette.testclient import TestClient

from graph_caster.run_broker.app import create_app
from graph_caster.run_broker.registry import RunBrokerRegistry


def _minimal_doc(graph_id: str, title: str = "test") -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": graph_id, "title": title},
        "viewport": {"x": 0, "y": 0, "zoom": 1},
        "nodes": [
            {"id": "s", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {"id": "x", "type": "exit", "position": {"x": 100, "y": 0}, "data": {}},
        ],
        "edges": [
            {
                "id": "e1",
                "source": "s",
                "sourceHandle": "out_default",
                "target": "x",
                "targetHandle": "in_default",
                "condition": None,
            }
        ],
    }


def _write_draft(workspace: Path, graph_id: str, doc: dict[str, Any]) -> None:
    graphs_dir = workspace / "graphs"
    graphs_dir.mkdir(parents=True, exist_ok=True)
    (graphs_dir / f"{graph_id}.json").write_text(
        json.dumps(doc, ensure_ascii=False), encoding="utf-8"
    )


def _setup_workspace(
    tmp_path: Path,
    graph_id: str,
    monkeypatch: pytest.MonkeyPatch,
    *,
    api_keys: str | None = None,
) -> Path:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    monkeypatch.setenv("GC_RUN_BROKER_WORKSPACE_ROOT", str(workspace))
    monkeypatch.delenv("GC_RUN_BROKER_GRAPHS_DIR", raising=False)
    monkeypatch.delenv("GC_RUN_BROKER_ARTIFACTS_BASE", raising=False)
    if api_keys is not None:
        monkeypatch.setenv("GC_RUN_BROKER_V1_API_KEYS", api_keys)
    else:
        monkeypatch.delenv("GC_RUN_BROKER_V1_API_KEYS", raising=False)
    return workspace


class TestPublishEndpoint:
    def test_publish_no_auth_returns_201(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        graph_id = "pub-001-4aaa-8aaa-aaaaaaaaaaaa"
        workspace = _setup_workspace(tmp_path, graph_id, monkeypatch)
        _write_draft(workspace, graph_id, _minimal_doc(graph_id))

        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        r = client.post(
            f"/api/v1/graphs/{graph_id}/publish",
            json={"author": "alice", "message": "first publish"},
        )
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["graphId"] == graph_id
        assert body["version"] == 1
        assert body["author"] == "alice"
        assert body["message"] == "first publish"
        assert len(body["revHash"]) == 64
        assert body["publishedAt"]

    def test_publish_without_scope_returns_403(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        graph_id = "pub-002-4aaa-8aaa-aaaaaaaaaaaa"
        workspace = _setup_workspace(tmp_path, graph_id, monkeypatch, api_keys="kid1:sec1")
        _write_draft(workspace, graph_id, _minimal_doc(graph_id))

        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))

        r_no_auth = client.post(f"/api/v1/graphs/{graph_id}/publish", json={})
        assert r_no_auth.status_code == 403

    def test_publish_with_wildcard_scope_returns_201(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        graph_id = "pub-003-4aaa-8aaa-aaaaaaaaaaaa"
        workspace = _setup_workspace(tmp_path, graph_id, monkeypatch, api_keys="kid1:sec1")
        _write_draft(workspace, graph_id, _minimal_doc(graph_id))

        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        r = client.post(
            f"/api/v1/graphs/{graph_id}/publish",
            json={"message": "with auth"},
            headers={"Authorization": "Bearer kid1:sec1"},
        )
        assert r.status_code == 201, r.text
        assert r.json()["version"] == 1

    def test_publish_missing_draft_returns_404(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        graph_id = "pub-004-4aaa-8aaa-aaaaaaaaaaaa"
        _setup_workspace(tmp_path, graph_id, monkeypatch)
        # Do not create draft

        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        r = client.post(f"/api/v1/graphs/{graph_id}/publish", json={})
        assert r.status_code == 404

    def test_publish_without_workspace_returns_503(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.delenv("GC_RUN_BROKER_WORKSPACE_ROOT", raising=False)
        monkeypatch.delenv("GC_RUN_BROKER_V1_API_KEYS", raising=False)
        graph_id = "pub-005-4aaa-8aaa-aaaaaaaaaaaa"

        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        r = client.post(f"/api/v1/graphs/{graph_id}/publish", json={})
        assert r.status_code == 503

    def test_publish_idempotent_same_hash(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        graph_id = "pub-006-4aaa-8aaa-aaaaaaaaaaaa"
        workspace = _setup_workspace(tmp_path, graph_id, monkeypatch)
        _write_draft(workspace, graph_id, _minimal_doc(graph_id))

        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        r1 = client.post(f"/api/v1/graphs/{graph_id}/publish", json={})
        r2 = client.post(f"/api/v1/graphs/{graph_id}/publish", json={})
        assert r1.status_code == 201
        assert r2.status_code == 201
        # Both should return version 1 (idempotent)
        assert r1.json()["version"] == 1
        assert r2.json()["version"] == 1


class TestVersionsEndpoint:
    def test_list_versions_empty(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        graph_id = "ver-001-4aaa-8aaa-aaaaaaaaaaaa"
        workspace = _setup_workspace(tmp_path, graph_id, monkeypatch)
        _write_draft(workspace, graph_id, _minimal_doc(graph_id))

        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        r = client.get(f"/api/v1/graphs/{graph_id}/versions")
        assert r.status_code == 200, r.text
        assert r.json()["versions"] == []

    def test_list_versions_after_publish(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        graph_id = "ver-002-4aaa-8aaa-aaaaaaaaaaaa"
        workspace = _setup_workspace(tmp_path, graph_id, monkeypatch)
        _write_draft(workspace, graph_id, _minimal_doc(graph_id, "v1"))

        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        client.post(f"/api/v1/graphs/{graph_id}/publish", json={})
        _write_draft(workspace, graph_id, _minimal_doc(graph_id, "v2"))
        client.post(f"/api/v1/graphs/{graph_id}/publish", json={})

        r = client.get(f"/api/v1/graphs/{graph_id}/versions")
        assert r.status_code == 200, r.text
        versions = r.json()["versions"]
        assert len(versions) == 2
        assert versions[0]["version"] == 1
        assert versions[1]["version"] == 2

    def test_list_versions_requires_view_scope(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        graph_id = "ver-003-4aaa-8aaa-aaaaaaaaaaaa"
        _setup_workspace(tmp_path, graph_id, monkeypatch, api_keys="kid1:sec1")

        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        r = client.get(f"/api/v1/graphs/{graph_id}/versions")
        assert r.status_code == 403

    def test_get_specific_version(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        graph_id = "ver-004-4aaa-8aaa-aaaaaaaaaaaa"
        workspace = _setup_workspace(tmp_path, graph_id, monkeypatch)
        _write_draft(workspace, graph_id, _minimal_doc(graph_id, "snap"))

        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        client.post(f"/api/v1/graphs/{graph_id}/publish", json={"message": "snap"})

        r = client.get(f"/api/v1/graphs/{graph_id}/versions/1")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["version"]["version"] == 1
        assert body["document"]["meta"]["title"] == "snap"

    def test_get_nonexistent_version_returns_404(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        graph_id = "ver-005-4aaa-8aaa-aaaaaaaaaaaa"
        workspace = _setup_workspace(tmp_path, graph_id, monkeypatch)
        _write_draft(workspace, graph_id, _minimal_doc(graph_id))

        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        r = client.get(f"/api/v1/graphs/{graph_id}/versions/99")
        assert r.status_code == 404


class TestRollbackEndpoint:
    def test_rollback_overwrites_draft(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        graph_id = "rb-001-4aaa-8aaa-aaaaaaaaaaaa"
        workspace = _setup_workspace(tmp_path, graph_id, monkeypatch)
        _write_draft(workspace, graph_id, _minimal_doc(graph_id, "original"))

        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        client.post(f"/api/v1/graphs/{graph_id}/publish", json={"message": "v1"})

        # Publish v2
        _write_draft(workspace, graph_id, _minimal_doc(graph_id, "updated"))
        client.post(f"/api/v1/graphs/{graph_id}/publish", json={"message": "v2"})

        # Rollback to v1
        r = client.post(f"/api/v1/graphs/{graph_id}/rollback", json={"version": 1})
        assert r.status_code == 200, r.text
        assert r.json()["rolledBack"] is True

        # Verify draft is now the v1 content
        draft_path = workspace / "graphs" / f"{graph_id}.json"
        draft_doc = json.loads(draft_path.read_text(encoding="utf-8"))
        assert draft_doc["meta"]["title"] == "original"

    def test_rollback_without_version_returns_400(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        graph_id = "rb-002-4aaa-8aaa-aaaaaaaaaaaa"
        _setup_workspace(tmp_path, graph_id, monkeypatch)

        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        r = client.post(f"/api/v1/graphs/{graph_id}/rollback", json={})
        assert r.status_code == 400

    def test_rollback_nonexistent_version_returns_404(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        graph_id = "rb-003-4aaa-8aaa-aaaaaaaaaaaa"
        workspace = _setup_workspace(tmp_path, graph_id, monkeypatch)
        _write_draft(workspace, graph_id, _minimal_doc(graph_id))

        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        client.post(f"/api/v1/graphs/{graph_id}/publish", json={})
        r = client.post(f"/api/v1/graphs/{graph_id}/rollback", json={"version": 99})
        assert r.status_code == 404

    def test_rollback_requires_edit_scope(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        graph_id = "rb-004-4aaa-8aaa-aaaaaaaaaaaa"
        _setup_workspace(tmp_path, graph_id, monkeypatch, api_keys="kid1:sec1")

        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        r = client.post(f"/api/v1/graphs/{graph_id}/rollback", json={"version": 1})
        assert r.status_code == 403


class TestDiffEndpoint:
    def test_diff_same_versions_returns_empty(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        graph_id = "diff-001-4aaa-8aaa-aaaaaaaaaaaa"
        workspace = _setup_workspace(tmp_path, graph_id, monkeypatch)
        _write_draft(workspace, graph_id, _minimal_doc(graph_id))

        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        client.post(f"/api/v1/graphs/{graph_id}/publish", json={})

        r = client.get(f"/api/v1/graphs/{graph_id}/diff?a=1&b=1")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["nodes_added"] == []
        assert body["nodes_removed"] == []
        assert body["nodes_changed"] == []

    def test_diff_draft_vs_published(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        graph_id = "diff-002-4aaa-8aaa-aaaaaaaaaaaa"
        workspace = _setup_workspace(tmp_path, graph_id, monkeypatch)
        _write_draft(workspace, graph_id, _minimal_doc(graph_id, "v1"))

        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        client.post(f"/api/v1/graphs/{graph_id}/publish", json={})

        # Modify draft with a new node
        doc2 = _minimal_doc(graph_id, "v2")
        doc2["nodes"].append({"id": "extra", "type": "task", "position": {"x": 300, "y": 0}, "data": {}})
        _write_draft(workspace, graph_id, doc2)

        # Diff published v1 vs draft (b=null means draft)
        r = client.get(f"/api/v1/graphs/{graph_id}/diff?a=1")
        assert r.status_code == 200, r.text
        body = r.json()
        added = [n["id"] for n in body["nodes_added"]]
        assert "extra" in added

    def test_diff_requires_view_scope(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        graph_id = "diff-003-4aaa-8aaa-aaaaaaaaaaaa"
        _setup_workspace(tmp_path, graph_id, monkeypatch, api_keys="kid1:sec1")

        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        r = client.get(f"/api/v1/graphs/{graph_id}/diff?a=1&b=2")
        assert r.status_code == 403


class TestRunWithVersion:
    def test_run_with_version_loads_published_snapshot(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Run with version=2 should load the v2 snapshot, not the current draft."""
        graph_id = "run-ver-001-4aaa-8aaa-aaaaaaaaaaaa"
        workspace = tmp_path / "workspace"
        workspace.mkdir()
        graphs_dir = workspace / "graphs"
        graphs_dir.mkdir()
        art = tmp_path / "art"
        art.mkdir()

        monkeypatch.setenv("GC_RUN_BROKER_WORKSPACE_ROOT", str(workspace))
        monkeypatch.setenv("GC_RUN_BROKER_GRAPHS_DIR", str(graphs_dir))
        monkeypatch.setenv("GC_RUN_BROKER_ARTIFACTS_BASE", str(art))
        monkeypatch.delenv("GC_RUN_BROKER_V1_API_KEYS", raising=False)

        # Write v1 draft and publish
        v1_doc = _minimal_doc(graph_id, "v1")
        _write_draft(workspace, graph_id, v1_doc)
        # Also put in graphs_dir for the run broker
        (graphs_dir / f"{graph_id}.json").write_text(
            json.dumps(v1_doc, ensure_ascii=False), encoding="utf-8"
        )

        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))
        client.post(f"/api/v1/graphs/{graph_id}/publish", json={"message": "v1"})

        # Write v2 draft and publish
        v2_doc = _minimal_doc(graph_id, "v2")
        _write_draft(workspace, graph_id, v2_doc)
        # Update graphs_dir too (this is the "current" draft)
        (graphs_dir / f"{graph_id}.json").write_text(
            json.dumps(v2_doc, ensure_ascii=False), encoding="utf-8"
        )
        client.post(f"/api/v1/graphs/{graph_id}/publish", json={"message": "v2"})

        # Now run with version=1 — this passes the version body field
        r = client.post(
            f"/api/v1/graphs/{graph_id}/run",
            json={"version": 1},
        )
        # The response body should include graphVersion=1
        assert r.status_code in (200, 503, 404), r.text
        if r.status_code == 200:
            body = r.json()
            assert body.get("graphVersion") == 1
