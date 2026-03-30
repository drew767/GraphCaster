# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from pathlib import Path

from graph_caster.history.artifacts import list_run_artifact_tree


def test_list_run_artifact_tree_empty_dir(tmp_path: Path) -> None:
    run = tmp_path / "run1"
    run.mkdir()
    assert list_run_artifact_tree(run) == []


def test_list_run_artifact_tree_nested_files(tmp_path: Path) -> None:
    run = tmp_path / "run1"
    run.mkdir()
    (run / "events.ndjson").write_text("{}", encoding="utf-8")
    sub = run / "out"
    sub.mkdir()
    (sub / "a.txt").write_text("hi", encoding="utf-8")
    (sub / "z.txt").write_text("longer", encoding="utf-8")

    entries = list_run_artifact_tree(run, max_entries=100)
    paths = [e.rel_path for e in entries]
    assert "events.ndjson" in paths
    assert "out" in paths
    assert "out/a.txt" in paths
    assert "out/z.txt" in paths

    by_path = {e.rel_path: e for e in entries}
    assert by_path["events.ndjson"].is_dir is False
    assert by_path["events.ndjson"].size_bytes == 2
    assert by_path["out"].is_dir is True
    assert by_path["out"].size_bytes is None
