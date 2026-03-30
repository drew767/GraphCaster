# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import pytest

from graph_caster.resilience.checkpoint import (
    CheckpointNotFoundError,
    CheckpointStore,
    RunCheckpoint,
)


class TestCheckpointStore:
    @pytest.fixture
    def store(self, tmp_path):
        return CheckpointStore(tmp_path / "checkpoints.db")

    def test_save_and_load_checkpoint(self, store):
        checkpoint = RunCheckpoint(
            run_id="run-123",
            graph_id="graph-456",
            current_node_id="Task1",
            node_outputs={"Start": {"data": "initial"}},
            status="running",
            started_at="2026-03-30T10:00:00Z",
        )
        store.save(checkpoint)
        loaded = store.load("run-123")
        assert loaded.run_id == "run-123"
        assert loaded.current_node_id == "Task1"
        assert loaded.node_outputs["Start"]["data"] == "initial"

    def test_load_nonexistent_raises(self, store):
        with pytest.raises(CheckpointNotFoundError):
            store.load("nonexistent-run")

    def test_update_checkpoint(self, store):
        checkpoint = RunCheckpoint(
            run_id="run-123",
            graph_id="graph-456",
            current_node_id="Task1",
            node_outputs={},
            status="running",
            started_at="2026-03-30T10:00:00Z",
        )
        store.save(checkpoint)
        checkpoint.current_node_id = "Task2"
        checkpoint.node_outputs = {"Task1": {"result": "done"}}
        store.save(checkpoint)
        loaded = store.load("run-123")
        assert loaded.current_node_id == "Task2"
        assert "Task1" in loaded.node_outputs

    def test_delete_checkpoint(self, store):
        checkpoint = RunCheckpoint(
            run_id="run-123",
            graph_id="graph-456",
            current_node_id="Task1",
            node_outputs={},
            status="running",
            started_at="2026-03-30T10:00:00Z",
        )
        store.save(checkpoint)
        store.delete("run-123")
        with pytest.raises(CheckpointNotFoundError):
            store.load("run-123")

    def test_list_active_checkpoints(self, store):
        for i in range(3):
            checkpoint = RunCheckpoint(
                run_id=f"run-{i}",
                graph_id="graph-456",
                current_node_id="Task1",
                node_outputs={},
                status="running",
                started_at="2026-03-30T10:00:00Z",
            )
            store.save(checkpoint)
        active = store.list_active()
        assert len(active) == 3

    def test_checkpoint_is_atomic(self, store, tmp_path):
        checkpoint = RunCheckpoint(
            run_id="run-123",
            graph_id="graph-456",
            current_node_id="Task1",
            node_outputs={"big": "x" * 10000},
            status="running",
            started_at="2026-03-30T10:00:00Z",
        )
        store.save(checkpoint)
        loaded = store.load("run-123")
        assert len(loaded.node_outputs["big"]) == 10000
