# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import pytest

pytest.importorskip("starlette")

from starlette.testclient import TestClient

from graph_caster.annotations import Annotation, AnnotationStore
from graph_caster.run_broker.app import create_app
from graph_caster.run_broker.auth.api_key import APIKeyAuthenticator
from graph_caster.run_broker.registry import RunBrokerRegistry
from graph_caster.run_broker.routes.api_v1 import APIV1Handler
from graph_caster.run_broker.routes.api_v1_routes import make_api_v1_routes


def _setup_run(
    tmp_path: Path,
    graph_id: str,
    run_id: str,
    monkeypatch: pytest.MonkeyPatch,
) -> Path:
    """Create artifact dir structure and bind run in env."""
    art = tmp_path / "artifacts"
    run_dir = art / "runs" / graph_id / "20260101T000000_testtest"
    run_dir.mkdir(parents=True)
    (run_dir / "run-summary.json").write_text(
        json.dumps({"runId": run_id, "status": "success"}),
        encoding="utf-8",
    )
    monkeypatch.setenv("GC_RUN_BROKER_ARTIFACTS_BASE", str(art))
    return art


class TestAnnotationsAPI:
    def test_post_annotation_no_auth_no_key_configured(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        graph_id = "ggggggg-1111-4111-8111-111111111111"
        run_id = "rrrrrr-1111-4111-8111-111111111111"
        _setup_run(tmp_path, graph_id, run_id, monkeypatch)
        monkeypatch.delenv("GC_RUN_BROKER_V1_API_KEYS", raising=False)
        monkeypatch.delenv("GC_RUN_BROKER_GRAPHS_DIR", raising=False)

        reg = RunBrokerRegistry()
        reg.bind_run_graph_id(run_id, graph_id)
        client = TestClient(create_app(reg))

        r = client.post(
            f"/api/v1/runs/{run_id}/annotations",
            json={"id": "ann-1", "rating": 5, "comment": "great"},
        )
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["id"] == "ann-1"
        assert body["rating"] == 5

    def test_post_annotation_requires_annotate_scope(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        graph_id = "ggggggg-2222-4222-8222-222222222222"
        run_id = "rrrrrr-2222-4222-8222-222222222222"
        _setup_run(tmp_path, graph_id, run_id, monkeypatch)
        monkeypatch.setenv("GC_RUN_BROKER_V1_API_KEYS", "kid1:secret1")
        monkeypatch.delenv("GC_RUN_BROKER_GRAPHS_DIR", raising=False)

        reg = RunBrokerRegistry()
        reg.bind_run_graph_id(run_id, graph_id)
        client = TestClient(create_app(reg))

        r_no_auth = client.post(
            f"/api/v1/runs/{run_id}/annotations",
            json={"id": "ann-x", "rating": 3},
        )
        assert r_no_auth.status_code == 403

        r_with_auth = client.post(
            f"/api/v1/runs/{run_id}/annotations",
            json={"id": "ann-y", "rating": 3},
            headers={"Authorization": "Bearer kid1:secret1"},
        )
        assert r_with_auth.status_code == 201, r_with_auth.text

    def test_post_annotation_invalid_run_returns_404(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv(
            "GC_RUN_BROKER_ARTIFACTS_BASE", str(tmp_path / "artifacts")
        )
        monkeypatch.delenv("GC_RUN_BROKER_V1_API_KEYS", raising=False)
        monkeypatch.delenv("GC_RUN_BROKER_GRAPHS_DIR", raising=False)

        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))

        r = client.post(
            "/api/v1/runs/not-a-real-run/annotations",
            json={"id": "ann-404", "rating": 1},
        )
        assert r.status_code == 404

    def test_get_annotations_returns_list(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        graph_id = "ggggggg-3333-4333-8333-333333333333"
        run_id = "rrrrrr-3333-4333-8333-333333333333"
        art = _setup_run(tmp_path, graph_id, run_id, monkeypatch)
        monkeypatch.delenv("GC_RUN_BROKER_V1_API_KEYS", raising=False)
        monkeypatch.delenv("GC_RUN_BROKER_GRAPHS_DIR", raising=False)

        store = AnnotationStore(art)
        asyncio.run(
            store.add(
                graph_id,
                Annotation(
                    id="existing-1",
                    run_id=run_id,
                    rating=4,
                    comment="preseeded",
                ),
            )
        )

        reg = RunBrokerRegistry()
        reg.bind_run_graph_id(run_id, graph_id)
        client = TestClient(create_app(reg))

        r = client.get(f"/api/v1/runs/{run_id}/annotations")
        assert r.status_code == 200, r.text
        body = r.json()
        assert "annotations" in body
        items = body["annotations"]
        assert any(a["id"] == "existing-1" for a in items)

    def test_delete_annotation_removes_it(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        graph_id = "ggggggg-4444-4444-8444-444444444444"
        run_id = "rrrrrr-4444-4444-8444-444444444444"
        art = _setup_run(tmp_path, graph_id, run_id, monkeypatch)
        monkeypatch.delenv("GC_RUN_BROKER_V1_API_KEYS", raising=False)
        monkeypatch.delenv("GC_RUN_BROKER_GRAPHS_DIR", raising=False)

        store = AnnotationStore(art)
        asyncio.run(
            store.add(
                graph_id,
                Annotation(id="del-me", run_id=run_id, rating=2),
            )
        )

        reg = RunBrokerRegistry()
        reg.bind_run_graph_id(run_id, graph_id)
        client = TestClient(create_app(reg))

        r = client.delete(f"/api/v1/runs/{run_id}/annotations/del-me")
        assert r.status_code == 200, r.text
        assert r.json()["deleted"] == "del-me"

        r2 = client.get(f"/api/v1/runs/{run_id}/annotations")
        assert all(a["id"] != "del-me" for a in r2.json()["annotations"])

    def test_delete_annotation_404_when_not_found(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        graph_id = "ggggggg-5555-4555-8555-555555555555"
        run_id = "rrrrrr-5555-4555-8555-555555555555"
        _setup_run(tmp_path, graph_id, run_id, monkeypatch)
        monkeypatch.delenv("GC_RUN_BROKER_V1_API_KEYS", raising=False)
        monkeypatch.delenv("GC_RUN_BROKER_GRAPHS_DIR", raising=False)

        reg = RunBrokerRegistry()
        reg.bind_run_graph_id(run_id, graph_id)
        client = TestClient(create_app(reg))

        r = client.delete(f"/api/v1/runs/{run_id}/annotations/does-not-exist")
        assert r.status_code == 404

    def test_get_graph_annotations_with_pagination(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        graph_id = "ggggggg-6666-4666-8666-666666666666"
        art = tmp_path / "artifacts"
        monkeypatch.setenv("GC_RUN_BROKER_ARTIFACTS_BASE", str(art))
        monkeypatch.delenv("GC_RUN_BROKER_V1_API_KEYS", raising=False)
        monkeypatch.delenv("GC_RUN_BROKER_GRAPHS_DIR", raising=False)

        store = AnnotationStore(art)
        for i in range(5):
            run_id = f"run-page-{i}"
            run_dir = art / "runs" / graph_id / f"2026010{i}T000000_page{i:04d}"
            run_dir.mkdir(parents=True)
            (run_dir / "run-summary.json").write_text(
                json.dumps({"runId": run_id}), encoding="utf-8"
            )
            asyncio.run(
                store.add(
                    graph_id,
                    Annotation(id=f"page-ann-{i}", run_id=run_id, rating=i + 1),
                )
            )

        reg = RunBrokerRegistry()
        client = TestClient(create_app(reg))

        r = client.get(f"/api/v1/graphs/{graph_id}/annotations?limit=3")
        assert r.status_code == 200, r.text
        body = r.json()
        assert len(body["annotations"]) == 3
        cursor = body["cursor"]
        assert cursor is not None

        r2 = client.get(f"/api/v1/graphs/{graph_id}/annotations?limit=3&cursor={cursor}")
        assert r2.status_code == 200, r2.text
        body2 = r2.json()
        assert len(body2["annotations"]) == 2
        assert body2["cursor"] is None
