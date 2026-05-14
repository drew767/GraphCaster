# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import asyncio
import csv
import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from graph_caster.annotations import Annotation, AnnotationStore
from graph_caster.dataset_export import export_dataset


def _seed_run(
    artifacts_base: Path,
    graph_id: str,
    run_id: str,
    annotations: list[Annotation],
) -> None:
    run_dir = artifacts_base / "runs" / graph_id / f"20260101T000000_{run_id[:8]}"
    run_dir.mkdir(parents=True, exist_ok=True)
    summary = {
        "runId": run_id,
        "status": "success",
        "inputs": {"question": f"What is {run_id}?"},
        "node_outputs": {
            "node-a": {"answer": f"answer-for-{run_id}"},
        },
    }
    (run_dir / "run-summary.json").write_text(json.dumps(summary), encoding="utf-8")

    store = AnnotationStore(artifacts_base)
    for ann in annotations:
        asyncio.run(store.add(graph_id, ann))


class TestExportJsonl:
    def test_basic_jsonl_export(self, tmp_path: Path) -> None:
        graph_id = "export-graph-1"
        run_id = "run-export-1"
        anns = [
            Annotation(
                id="a1",
                run_id=run_id,
                node_id="node-a",
                rating=5,
                suggested_output={"answer": "corrected"},
                labels=["good"],
            )
        ]
        _seed_run(tmp_path, graph_id, run_id, anns)

        out = tmp_path / "output.jsonl"
        count = export_dataset(tmp_path, graph_id, out, fmt="jsonl")
        assert count == 1

        lines = [json.loads(l) for l in out.read_text(encoding="utf-8").splitlines() if l.strip()]
        assert len(lines) == 1
        rec = lines[0]
        assert "prompt" in rec
        assert "completion" in rec
        assert "metadata" in rec
        assert rec["completion"] == json.dumps({"answer": "corrected"}, ensure_ascii=False)
        assert rec["metadata"]["rating"] == 5

    def test_jsonl_uses_actual_output_when_no_suggested_and_high_rating(self, tmp_path: Path) -> None:
        graph_id = "export-graph-2"
        run_id = "run-export-2"
        anns = [
            Annotation(
                id="a2",
                run_id=run_id,
                node_id="node-a",
                rating=4,
                suggested_output=None,
                labels=[],
            )
        ]
        _seed_run(tmp_path, graph_id, run_id, anns)

        out = tmp_path / "output2.jsonl"
        count = export_dataset(tmp_path, graph_id, out, fmt="jsonl")
        assert count == 1
        lines = [json.loads(l) for l in out.read_text(encoding="utf-8").splitlines() if l.strip()]
        assert lines[0]["completion"] != ""

    def test_jsonl_excludes_low_rated_without_suggested_output(self, tmp_path: Path) -> None:
        graph_id = "export-graph-3"
        run_id = "run-export-3"
        anns = [
            Annotation(id="a3-low", run_id=run_id, rating=2, suggested_output=None),
            Annotation(id="a3-high", run_id=run_id, rating=4, suggested_output={"x": 1}),
        ]
        _seed_run(tmp_path, graph_id, run_id, anns)

        out = tmp_path / "output3.jsonl"
        count = export_dataset(tmp_path, graph_id, out, fmt="jsonl")
        assert count == 1
        lines = [json.loads(l) for l in out.read_text(encoding="utf-8").splitlines() if l.strip()]
        assert lines[0]["metadata"]["rating"] == 4


class TestExportOpenAIFt:
    def test_openai_ft_format(self, tmp_path: Path) -> None:
        graph_id = "export-oai-1"
        run_id = "run-oai-1"
        anns = [
            Annotation(
                id="oai-1",
                run_id=run_id,
                rating=5,
                suggested_output={"reply": "I am an AI"},
            )
        ]
        _seed_run(tmp_path, graph_id, run_id, anns)

        out = tmp_path / "openai.jsonl"
        count = export_dataset(tmp_path, graph_id, out, fmt="openai-ft")
        assert count == 1

        lines = [json.loads(l) for l in out.read_text(encoding="utf-8").splitlines() if l.strip()]
        assert len(lines) == 1
        messages = lines[0]["messages"]
        assert len(messages) == 2
        assert messages[0]["role"] == "user"
        assert messages[1]["role"] == "assistant"
        assert messages[1]["content"] != ""


class TestExportCsv:
    def test_csv_format(self, tmp_path: Path) -> None:
        graph_id = "export-csv-1"
        run_id = "run-csv-1"
        anns = [
            Annotation(
                id="csv-1",
                run_id=run_id,
                node_id="node-a",
                rating=5,
                comment="csv test",
                suggested_output={"val": 42},
            )
        ]
        _seed_run(tmp_path, graph_id, run_id, anns)

        out = tmp_path / "output.csv"
        count = export_dataset(tmp_path, graph_id, out, fmt="csv")
        assert count == 1

        with out.open(encoding="utf-8") as f:
            reader = csv.DictReader(f)
            rows = list(reader)
        assert len(rows) == 1
        assert rows[0]["run_id"] == run_id
        assert rows[0]["rating"] == "5"
        assert rows[0]["comment"] == "csv test"
        assert "prompt" in rows[0]
        assert "completion" in rows[0]


class TestExportFilters:
    def test_filter_min_rating(self, tmp_path: Path) -> None:
        graph_id = "export-filter-1"
        run_id = "run-filter-1"
        anns = [
            Annotation(id="f-low", run_id=run_id, rating=2, suggested_output={"x": 1}),
            Annotation(id="f-mid", run_id=run_id, rating=3, suggested_output={"x": 2}),
            Annotation(id="f-high", run_id=run_id, rating=5, suggested_output={"x": 3}),
        ]
        _seed_run(tmp_path, graph_id, run_id, anns)

        out = tmp_path / "filtered.jsonl"
        count = export_dataset(tmp_path, graph_id, out, fmt="jsonl", min_rating=3)
        assert count == 2

        lines = [json.loads(l) for l in out.read_text(encoding="utf-8").splitlines() if l.strip()]
        ratings = {l["metadata"]["rating"] for l in lines}
        assert ratings == {3, 5}

    def test_filter_min_rating_4_excludes_lower(self, tmp_path: Path) -> None:
        graph_id = "export-filter-2"
        run_id = "run-filter-2"
        anns = [
            Annotation(id="low1", run_id=run_id, rating=1, suggested_output={"x": 1}),
            Annotation(id="low2", run_id=run_id, rating=3, suggested_output={"x": 2}),
            Annotation(id="hi1", run_id=run_id, rating=4, suggested_output={"x": 3}),
            Annotation(id="hi2", run_id=run_id, rating=5, suggested_output={"x": 4}),
        ]
        _seed_run(tmp_path, graph_id, run_id, anns)

        out = tmp_path / "min4.jsonl"
        count = export_dataset(tmp_path, graph_id, out, fmt="jsonl", min_rating=4)
        assert count == 2

    def test_filter_node_id(self, tmp_path: Path) -> None:
        graph_id = "export-filter-3"
        run_id = "run-filter-3"
        anns = [
            Annotation(id="nf-1", run_id=run_id, node_id="node-a", rating=5, suggested_output={"a": 1}),
            Annotation(id="nf-2", run_id=run_id, node_id="node-b", rating=5, suggested_output={"b": 1}),
        ]
        _seed_run(tmp_path, graph_id, run_id, anns)

        out = tmp_path / "node_filter.jsonl"
        count = export_dataset(tmp_path, graph_id, out, fmt="jsonl", node_id="node-a")
        assert count == 1
        lines = [json.loads(l) for l in out.read_text(encoding="utf-8").splitlines() if l.strip()]
        assert lines[0]["metadata"]["node_id"] == "node-a"

    def test_filter_since_date(self, tmp_path: Path) -> None:
        graph_id = "export-filter-4"
        run_id = "run-filter-4"
        anns = [
            Annotation(
                id="old",
                run_id=run_id,
                rating=5,
                suggested_output={"x": 1},
                created_at="2025-01-01T00:00:00+00:00",
            ),
            Annotation(
                id="new",
                run_id=run_id,
                rating=5,
                suggested_output={"x": 2},
                created_at="2026-06-01T00:00:00+00:00",
            ),
        ]
        _seed_run(tmp_path, graph_id, run_id, anns)

        since = datetime(2026, 1, 1, tzinfo=timezone.utc)
        out = tmp_path / "since_filter.jsonl"
        count = export_dataset(tmp_path, graph_id, out, fmt="jsonl", since=since)
        assert count == 1
        lines = [json.loads(l) for l in out.read_text(encoding="utf-8").splitlines() if l.strip()]
        assert lines[0]["metadata"]["run_id"] == run_id

    def test_filter_labels(self, tmp_path: Path) -> None:
        graph_id = "export-filter-5"
        run_id = "run-filter-5"
        anns = [
            Annotation(
                id="lbl-yes",
                run_id=run_id,
                rating=5,
                suggested_output={"v": 1},
                labels=["qa", "verified"],
            ),
            Annotation(
                id="lbl-no",
                run_id=run_id,
                rating=5,
                suggested_output={"v": 2},
                labels=["qa"],
            ),
        ]
        _seed_run(tmp_path, graph_id, run_id, anns)

        out = tmp_path / "label_filter.jsonl"
        count = export_dataset(tmp_path, graph_id, out, fmt="jsonl", labels=["verified"])
        assert count == 1
        lines = [json.loads(l) for l in out.read_text(encoding="utf-8").splitlines() if l.strip()]
        assert "verified" in lines[0]["metadata"]["labels"]

    def test_unknown_format_raises(self, tmp_path: Path) -> None:
        graph_id = "export-bad-fmt"
        run_id = "run-bad-fmt"
        _seed_run(tmp_path, graph_id, run_id, [])

        out = tmp_path / "bad.xyz"
        with pytest.raises(ValueError, match="Unknown format"):
            export_dataset(tmp_path, graph_id, out, fmt="xyz")
