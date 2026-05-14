# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from graph_caster.annotations import Annotation, AnnotationStore


def _make_ann(run_id: str = "run-1", **kwargs) -> Annotation:
    defaults = dict(
        id="",
        run_id=run_id,
        node_id=None,
        rating=4,
        comment="looks good",
        suggested_output=None,
        labels=["qa"],
        author="tester",
        created_at="",
    )
    defaults.update(kwargs)
    return Annotation(**defaults)


class TestAnnotationDataclass:
    def test_to_dict_roundtrip(self) -> None:
        ann = Annotation(
            id="a1",
            run_id="r1",
            node_id="n1",
            rating=5,
            comment="perfect",
            suggested_output={"text": "hello"},
            labels=["good", "qa"],
            author="alice",
            created_at="2026-01-01T00:00:00+00:00",
        )
        d = ann.to_dict()
        assert d["id"] == "a1"
        assert d["rating"] == 5
        assert d["suggested_output"] == {"text": "hello"}
        restored = Annotation.from_dict(d)
        assert restored.id == ann.id
        assert restored.rating == ann.rating
        assert restored.labels == ann.labels

    def test_from_dict_defaults(self) -> None:
        ann = Annotation.from_dict({"id": "x", "run_id": "r"})
        assert ann.comment == ""
        assert ann.labels == []
        assert ann.rating is None
        assert ann.node_id is None


class TestAnnotationStore:
    def test_add_and_list_for_run(self, tmp_path: Path) -> None:
        store = AnnotationStore(tmp_path)
        graph_id = "g-001"
        run_id = "run-abc"

        run_dir = tmp_path / "runs" / graph_id / "20260101T000000_aabbccdd"
        run_dir.mkdir(parents=True)
        summary = {"runId": run_id, "status": "success"}
        (run_dir / "run-summary.json").write_text(json.dumps(summary), encoding="utf-8")

        ann = _make_ann(run_id=run_id, id="ann-1")
        asyncio.run(store.add(graph_id, ann))

        items = asyncio.run(store.list_for_run(graph_id, run_id))
        assert len(items) == 1
        assert items[0].id == "ann-1"
        assert items[0].rating == 4
        assert items[0].labels == ["qa"]

    def test_add_assigns_uuid_when_id_empty(self, tmp_path: Path) -> None:
        store = AnnotationStore(tmp_path)
        graph_id = "g-001"
        run_id = "run-abc"

        run_dir = tmp_path / "runs" / graph_id / "20260101T000000_aabbccdd"
        run_dir.mkdir(parents=True)
        (run_dir / "run-summary.json").write_text(json.dumps({"runId": run_id}), encoding="utf-8")

        ann = _make_ann(run_id=run_id, id="")
        asyncio.run(store.add(graph_id, ann))
        items = asyncio.run(store.list_for_run(graph_id, run_id))
        assert len(items) == 1
        assert items[0].id != ""

    def test_add_assigns_created_at_when_empty(self, tmp_path: Path) -> None:
        store = AnnotationStore(tmp_path)
        graph_id = "g-001"
        run_id = "run-abc"

        run_dir = tmp_path / "runs" / graph_id / "20260101T000000_aabbccdd"
        run_dir.mkdir(parents=True)
        (run_dir / "run-summary.json").write_text(json.dumps({"runId": run_id}), encoding="utf-8")

        ann = _make_ann(run_id=run_id, id="ann-ts", created_at="")
        asyncio.run(store.add(graph_id, ann))
        items = asyncio.run(store.list_for_run(graph_id, run_id))
        assert items[0].created_at != ""

    def test_list_for_run_empty_when_no_file(self, tmp_path: Path) -> None:
        store = AnnotationStore(tmp_path)
        items = asyncio.run(store.list_for_run("g-001", "run-nope"))
        assert items == []

    def test_list_for_graph_aggregates_runs(self, tmp_path: Path) -> None:
        store = AnnotationStore(tmp_path)
        graph_id = "g-multi"

        for i in range(3):
            run_id = f"run-{i}"
            run_dir = tmp_path / "runs" / graph_id / f"2026010{i}T000000_aabb{i:04d}"
            run_dir.mkdir(parents=True)
            (run_dir / "run-summary.json").write_text(
                json.dumps({"runId": run_id}), encoding="utf-8"
            )
            ann = _make_ann(run_id=run_id, id=f"ann-{i}", rating=i + 1)
            asyncio.run(store.add(graph_id, ann))

        all_items = asyncio.run(store.list_for_graph(graph_id))
        assert len(all_items) == 3
        ratings = {a.rating for a in all_items}
        assert ratings == {1, 2, 3}

    def test_list_all_yields_across_graphs(self, tmp_path: Path) -> None:
        store = AnnotationStore(tmp_path)

        for gidx in range(2):
            graph_id = f"graph-{gidx}"
            run_id = f"run-g{gidx}"
            run_dir = tmp_path / "runs" / graph_id / f"20260101T000000_gg{gidx:04d}"
            run_dir.mkdir(parents=True)
            (run_dir / "run-summary.json").write_text(
                json.dumps({"runId": run_id}), encoding="utf-8"
            )
            ann = _make_ann(run_id=run_id, id=f"ga-{gidx}")
            asyncio.run(store.add(graph_id, ann))

        async def collect_all() -> list[Annotation]:
            items = []
            async for ann in store.list_all():
                items.append(ann)
            return items

        all_items = asyncio.run(collect_all())
        assert len(all_items) == 2

    def test_delete_removes_annotation(self, tmp_path: Path) -> None:
        store = AnnotationStore(tmp_path)
        graph_id = "g-del"
        run_id = "run-del"

        run_dir = tmp_path / "runs" / graph_id / "20260101T000000_deldel"
        run_dir.mkdir(parents=True)
        (run_dir / "run-summary.json").write_text(json.dumps({"runId": run_id}), encoding="utf-8")

        for i in range(3):
            ann = _make_ann(run_id=run_id, id=f"del-{i}")
            asyncio.run(store.add(graph_id, ann))

        deleted = asyncio.run(store.delete(graph_id, run_id, "del-1"))
        assert deleted is True

        items = asyncio.run(store.list_for_run(graph_id, run_id))
        ids = [a.id for a in items]
        assert "del-1" not in ids
        assert "del-0" in ids
        assert "del-2" in ids

    def test_delete_returns_false_for_unknown_id(self, tmp_path: Path) -> None:
        store = AnnotationStore(tmp_path)
        graph_id = "g-del2"
        run_id = "run-del2"

        run_dir = tmp_path / "runs" / graph_id / "20260101T000000_dd"
        run_dir.mkdir(parents=True)
        (run_dir / "run-summary.json").write_text(json.dumps({"runId": run_id}), encoding="utf-8")

        ann = _make_ann(run_id=run_id, id="keep-me")
        asyncio.run(store.add(graph_id, ann))

        deleted = asyncio.run(store.delete(graph_id, run_id, "not-there"))
        assert deleted is False

    def test_concurrent_appends_all_preserved(self, tmp_path: Path) -> None:
        store = AnnotationStore(tmp_path)
        graph_id = "g-concurrent"
        run_id = "run-concurrent"

        run_dir = tmp_path / "runs" / graph_id / "20260101T000000_cccc"
        run_dir.mkdir(parents=True)
        (run_dir / "run-summary.json").write_text(
            json.dumps({"runId": run_id}), encoding="utf-8"
        )

        N = 20

        async def run_concurrent() -> None:
            tasks = [
                store.add(graph_id, _make_ann(run_id=run_id, id=f"c-{i}"))
                for i in range(N)
            ]
            await asyncio.gather(*tasks)

        asyncio.run(run_concurrent())

        items = asyncio.run(store.list_for_run(graph_id, run_id))
        assert len(items) == N
        ids = {a.id for a in items}
        assert ids == {f"c-{i}" for i in range(N)}
