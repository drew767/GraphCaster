# Copyright GraphCaster. All Rights Reserved.

"""Index-backed lookup tests for graph_caster.pause_resume.CheckpointStore.

These complement test_pause_resume.py by asserting:
  * the index file is created/updated on save & delete,
  * hot lookups do NOT walk the disk,
  * the index rebuilds transparently if deleted (or if it points at a stale path),
  * concurrent writes do not corrupt the index file.
"""

from __future__ import annotations

import asyncio
import json
import threading
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


def _index_path(base: Path) -> Path:
    return base / ".graphcaster" / "pause-checkpoints.json"


class TestIndexFile:
    def test_index_created_on_save(self, tmp_path: Path) -> None:
        store = CheckpointStore(tmp_path)
        asyncio.run(store.save(_make_checkpoint("r1", "g1")))

        idx = _index_path(tmp_path)
        assert idx.is_file()
        data = json.loads(idx.read_text(encoding="utf-8"))
        assert data["version"] == 1
        assert data["entries"] == {"r1": "g1"}

    def test_index_updated_on_multiple_saves(self, tmp_path: Path) -> None:
        store = CheckpointStore(tmp_path)
        asyncio.run(store.save(_make_checkpoint("r1", "g1")))
        asyncio.run(store.save(_make_checkpoint("r2", "g2")))
        asyncio.run(store.save(_make_checkpoint("r3", "g1")))

        data = json.loads(_index_path(tmp_path).read_text(encoding="utf-8"))
        assert data["entries"] == {"r1": "g1", "r2": "g2", "r3": "g1"}

    def test_index_drops_entry_on_delete(self, tmp_path: Path) -> None:
        store = CheckpointStore(tmp_path)
        asyncio.run(store.save(_make_checkpoint("r1", "g1")))
        asyncio.run(store.save(_make_checkpoint("r2", "g2")))
        asyncio.run(store.delete("r1"))

        data = json.loads(_index_path(tmp_path).read_text(encoding="utf-8"))
        assert data["entries"] == {"r2": "g2"}


class TestHotLookupIsO1:
    """Lookups via a populated index must NOT trigger a directory walk."""

    def test_load_hot_index_does_not_walk(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        store = CheckpointStore(tmp_path)
        # Populate 100 checkpoints across 10 graphs.
        for g in range(10):
            for r in range(10):
                asyncio.run(
                    store.save(_make_checkpoint(f"run-{g:02d}-{r:02d}", f"graph-{g:02d}"))
                )

        # Reset the walk counter, then verify load() never walks.
        store._walk_calls = 0  # noqa: SLF001 — test-only access
        loaded = asyncio.run(store.load("run-05-05"))
        assert loaded is not None
        assert loaded.run_id == "run-05-05"
        assert store._walk_calls == 0  # noqa: SLF001

    def test_delete_hot_index_does_not_walk(self, tmp_path: Path) -> None:
        store = CheckpointStore(tmp_path)
        for g in range(5):
            for r in range(5):
                asyncio.run(
                    store.save(_make_checkpoint(f"run-{g}-{r}", f"graph-{g}"))
                )

        store._walk_calls = 0  # noqa: SLF001
        asyncio.run(store.delete("run-2-3"))
        assert store._walk_calls == 0  # noqa: SLF001
        # File actually gone.
        cp = tmp_path / "runs" / "graph-2" / "run-2-3" / "checkpoint.json"
        assert not cp.exists()

    def test_list_paused_uses_index_no_glob(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        store = CheckpointStore(tmp_path)
        for g in range(5):
            for r in range(5):
                asyncio.run(
                    store.save(_make_checkpoint(f"run-{g}-{r}", f"graph-{g}"))
                )

        store._walk_calls = 0  # noqa: SLF001
        listed = asyncio.run(store.list_paused())
        assert len(listed) == 25
        assert store._walk_calls == 0  # noqa: SLF001


class TestIndexRebuildOnMiss:
    def test_load_rebuilds_index_when_missing(self, tmp_path: Path) -> None:
        store = CheckpointStore(tmp_path)
        for g in range(3):
            for r in range(3):
                asyncio.run(
                    store.save(_make_checkpoint(f"run-{g}-{r}", f"graph-{g}"))
                )

        # Wipe the index file.
        idx = _index_path(tmp_path)
        assert idx.is_file()
        idx.unlink()

        # Lookup must still succeed (rebuilds via walk).
        loaded = asyncio.run(store.load("run-1-2"))
        assert loaded is not None
        assert loaded.run_id == "run-1-2"

        # And the index should now be present again after the lookup repaired it.
        assert idx.is_file()
        data = json.loads(idx.read_text(encoding="utf-8"))
        assert "run-1-2" in data["entries"]

    def test_load_recovers_from_stale_index_entry(self, tmp_path: Path) -> None:
        """An index entry pointing at a now-missing file should fall back to walk."""
        store = CheckpointStore(tmp_path)
        asyncio.run(store.save(_make_checkpoint("r1", "g1")))

        # Hand-edit the index to point r1 at a non-existent graph.
        idx = _index_path(tmp_path)
        data = json.loads(idx.read_text(encoding="utf-8"))
        data["entries"]["r1"] = "ghost-graph"
        idx.write_text(json.dumps(data), encoding="utf-8")

        # Load — index miss triggers walk, which finds the real checkpoint.
        loaded = asyncio.run(store.load("r1"))
        assert loaded is not None
        assert loaded.graph_id == "g1"

        # Stale entry repaired.
        repaired = json.loads(idx.read_text(encoding="utf-8"))
        assert repaired["entries"]["r1"] == "g1"

    def test_list_paused_falls_back_when_index_missing(self, tmp_path: Path) -> None:
        """list_paused must work even without a pre-built index."""
        # Create checkpoint files directly (bypassing CheckpointStore.save to
        # simulate a workspace that pre-dates the index).
        cp_dir = tmp_path / "runs" / "g1" / "r1"
        cp_dir.mkdir(parents=True)
        (cp_dir / "checkpoint.json").write_text(
            json.dumps(_make_checkpoint("r1", "g1").to_dict()), encoding="utf-8"
        )

        store = CheckpointStore(tmp_path)
        listed = asyncio.run(store.list_paused())
        assert len(listed) == 1
        assert listed[0].run_id == "r1"

        # And the index gets repaired in the process.
        assert _index_path(tmp_path).is_file()


class TestConcurrentWritesDontCorrupt:
    def test_concurrent_saves_yield_valid_json_index(self, tmp_path: Path) -> None:
        """50 threads save 50 checkpoints. The index must be valid JSON and
        contain all 50 entries (no torn writes, no lost updates)."""
        store = CheckpointStore(tmp_path)

        def _worker(i: int) -> None:
            asyncio.run(store.save(_make_checkpoint(f"run-{i:03d}", f"graph-{i % 5}")))

        threads = [threading.Thread(target=_worker, args=(i,)) for i in range(50)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        idx = _index_path(tmp_path)
        assert idx.is_file()
        # JSON parses (no torn write).
        data = json.loads(idx.read_text(encoding="utf-8"))
        assert data["version"] == 1
        entries = data["entries"]
        assert len(entries) == 50
        for i in range(50):
            assert entries[f"run-{i:03d}"] == f"graph-{i % 5}"

    def test_concurrent_save_and_delete_consistent(self, tmp_path: Path) -> None:
        store = CheckpointStore(tmp_path)
        # Pre-populate so delete has something to remove.
        for i in range(20):
            asyncio.run(store.save(_make_checkpoint(f"r{i}", f"g{i % 3}")))

        errors: list[Exception] = []

        def _save(i: int) -> None:
            try:
                asyncio.run(store.save(_make_checkpoint(f"new-{i}", "g-new")))
            except Exception as e:
                errors.append(e)

        def _delete(i: int) -> None:
            try:
                asyncio.run(store.delete(f"r{i}"))
            except Exception as e:
                errors.append(e)

        threads = []
        for i in range(20):
            threads.append(threading.Thread(target=_save, args=(i,)))
            threads.append(threading.Thread(target=_delete, args=(i,)))
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert errors == [], f"unexpected errors: {errors}"

        # Final index reflects the disk truth.
        data = json.loads(_index_path(tmp_path).read_text(encoding="utf-8"))
        for run_id, graph_id in data["entries"].items():
            cp = tmp_path / "runs" / graph_id / run_id / "checkpoint.json"
            assert cp.is_file(), f"index points at missing file: {cp}"


class TestScale:
    def test_load_among_100_runs_is_o1_via_index(self, tmp_path: Path) -> None:
        store = CheckpointStore(tmp_path)
        for i in range(100):
            asyncio.run(store.save(_make_checkpoint(f"run-{i:03d}", f"graph-{i % 10}")))

        store._walk_calls = 0  # noqa: SLF001
        for target in ("run-000", "run-050", "run-099"):
            loaded = asyncio.run(store.load(target))
            assert loaded is not None and loaded.run_id == target
        # Zero walks total — the index served every lookup.
        assert store._walk_calls == 0  # noqa: SLF001
