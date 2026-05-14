# Copyright GraphCaster. All Rights Reserved.

"""Unit tests for graph_caster.pause_resume.CheckpointStore."""

from __future__ import annotations

import asyncio
import json
import time
from pathlib import Path

import pytest

from graph_caster.pause_resume import CheckpointStore, PauseCheckpoint


def _make_checkpoint(run_id: str, graph_id: str) -> PauseCheckpoint:
    return PauseCheckpoint(
        run_id=run_id,
        graph_id=graph_id,
        paused_at_node="n1",
        node_outputs={},
        prompt="Approve?",
        kind="approval",
        choices=None,
        schema=None,
        paused_at="2026-05-14T00:00:00+00:00",
        timeout_sec=0.0,
    )


class TestCheckpointStoreBasics:
    def test_save_and_load_roundtrip(self, tmp_path: Path) -> None:
        store = CheckpointStore(tmp_path)
        asyncio.run(store.save(_make_checkpoint("r1", "g1")))

        loaded = asyncio.run(store.load("r1"))
        assert loaded is not None
        assert loaded.run_id == "r1"
        assert loaded.graph_id == "g1"
        assert loaded.paused_at_node == "n1"

    def test_load_missing_returns_none(self, tmp_path: Path) -> None:
        store = CheckpointStore(tmp_path)
        assert asyncio.run(store.load("does-not-exist")) is None

    def test_list_paused_returns_only_paused_status(self, tmp_path: Path) -> None:
        store = CheckpointStore(tmp_path)
        asyncio.run(store.save(_make_checkpoint("r1", "g1")))
        asyncio.run(store.save(_make_checkpoint("r2", "g2")))

        # Tamper with one to make it non-paused
        cp_path = tmp_path / "runs" / "g2" / "r2" / "checkpoint.json"
        data = json.loads(cp_path.read_text(encoding="utf-8"))
        data["status"] = "resumed"
        cp_path.write_text(json.dumps(data), encoding="utf-8")

        listed = asyncio.run(store.list_paused())
        listed_ids = {c.run_id for c in listed}
        assert listed_ids == {"r1"}

    def test_delete_removes_checkpoint(self, tmp_path: Path) -> None:
        store = CheckpointStore(tmp_path)
        asyncio.run(store.save(_make_checkpoint("r1", "g1")))
        asyncio.run(store.delete("r1"))
        assert asyncio.run(store.load("r1")) is None


class TestCheckpointStoreScalePerf:
    """Verify the checkpoint scan does not degrade quadratically.

    Creates 50 graphs each with 10 paused runs and asserts the structural scan
    completes promptly. JSON read I/O is excluded from the assertion since per-file
    read time is OS-bound and unrelated to the scan-strategy fix.
    """

    def _populate(self, tmp_path: Path, *, with_files: bool) -> CheckpointStore:
        """Build a tree of 50 graphs x 10 runs. If with_files=False, create only
        empty run dirs (no checkpoint.json) — exercises pure directory traversal."""
        store = CheckpointStore(tmp_path)
        if with_files:
            for g in range(50):
                for r in range(10):
                    gid = f"graph-{g:03d}"
                    rid = f"run-{g:03d}-{r:02d}"
                    asyncio.run(store.save(_make_checkpoint(rid, gid)))
        else:
            for g in range(50):
                for r in range(10):
                    p = tmp_path / "runs" / f"graph-{g:03d}" / f"run-{g:03d}-{r:02d}"
                    p.mkdir(parents=True, exist_ok=True)
        return store

    def test_list_paused_returns_all_500_checkpoints(self, tmp_path: Path) -> None:
        store = self._populate(tmp_path, with_files=True)

        t0 = time.perf_counter()
        listed = asyncio.run(store.list_paused())
        elapsed = time.perf_counter() - t0

        assert len(listed) == 500
        # Generous upper bound — actual bottleneck here is 500 small file reads, not
        # the directory scan. Pre-fix nested iterdir+is_dir made this *additionally*
        # slow; this asserts the scan does not regress catastrophically.
        assert elapsed < 5.0, f"list_paused took {elapsed:.3f}s (expected < 5.0s)"

    def test_structural_scan_empty_tree_under_one_second(self, tmp_path: Path) -> None:
        """Scan 50x10 empty run dirs (no checkpoint files) — pure directory traversal."""
        store = self._populate(tmp_path, with_files=False)

        t0 = time.perf_counter()
        listed = asyncio.run(store.list_paused())
        elapsed = time.perf_counter() - t0

        assert listed == []
        assert elapsed < 1.0, f"structural scan took {elapsed:.3f}s (expected < 1.0s)"

    def test_load_after_500_runs_is_fast(self, tmp_path: Path) -> None:
        """load() must hit checkpoint.json directly via glob, not O(graphs) iterdir."""
        store = self._populate(tmp_path, with_files=True)

        target_id = "run-025-05"
        t0 = time.perf_counter()
        loaded = asyncio.run(store.load(target_id))
        elapsed = time.perf_counter() - t0

        assert loaded is not None and loaded.run_id == target_id
        assert elapsed < 1.0, f"load took {elapsed:.3f}s (expected < 1.0s)"
