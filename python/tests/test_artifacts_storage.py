# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import pytest
from pathlib import Path

from graph_caster.artifacts import (
    artifacts_runs_total_bytes,
    artifacts_tree_bytes_for_graph,
    clear_all_artifact_runs,
    clear_artifacts_for_graph,
    create_root_run_artifact_dir,
    tree_bytes,
)


def test_tree_bytes_file_and_missing(tmp_path: Path) -> None:
    f = tmp_path / "a.bin"
    f.write_bytes(b"abcd")
    assert tree_bytes(f) == 4
    assert tree_bytes(tmp_path / "none") == 0


def test_artifacts_tree_bytes_for_graph_sums_nested_runs(tmp_path: Path) -> None:
    gid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    r1 = create_root_run_artifact_dir(tmp_path, gid)
    (r1 / "out.txt").write_text("hi", encoding="utf-8")
    r2 = create_root_run_artifact_dir(tmp_path, gid)
    (r2 / "deep" / "x").mkdir(parents=True)
    (r2 / "deep" / "x" / "y.bin").write_bytes(b"\x00" * 10)
    assert artifacts_tree_bytes_for_graph(tmp_path, gid) == 2 + 10
    assert artifacts_tree_bytes_for_graph(tmp_path, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb") == 0


def test_clear_artifacts_for_graph_removes_only_that_graph(tmp_path: Path) -> None:
    g1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    g2 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
    create_root_run_artifact_dir(tmp_path, g1)
    create_root_run_artifact_dir(tmp_path, g2)
    clear_artifacts_for_graph(tmp_path, g1)
    assert not (tmp_path / "runs" / g1).exists()
    assert (tmp_path / "runs" / g2).is_dir()


def test_clear_all_artifact_runs_removes_runs_dir(tmp_path: Path) -> None:
    create_root_run_artifact_dir(tmp_path, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee")
    clear_all_artifact_runs(tmp_path)
    assert not (tmp_path / "runs").exists()


def test_artifacts_runs_total_bytes(tmp_path: Path) -> None:
    create_root_run_artifact_dir(tmp_path, "ffffffff-ffff-4fff-8fff-ffffffffffff")
    create_root_run_artifact_dir(tmp_path, "99999999-9999-4999-8999-999999999999")
    (tmp_path / "runs" / "ffffffff-ffff-4fff-8fff-ffffffffffff" / "x" / "a").mkdir(parents=True)
    (tmp_path / "runs" / "ffffffff-ffff-4fff-8fff-ffffffffffff" / "x" / "a" / "f.txt").write_text("z", encoding="utf-8")
    assert artifacts_runs_total_bytes(tmp_path) >= 1


@pytest.mark.parametrize(
    "bad",
    ["", "default", "..", "a/b", "a\\b"],
)
def test_invalid_graph_id_raises(bad: str) -> None:
    with pytest.raises(ValueError):
        artifacts_tree_bytes_for_graph(Path("."), bad)
    with pytest.raises(ValueError):
        clear_artifacts_for_graph(Path("."), bad)
