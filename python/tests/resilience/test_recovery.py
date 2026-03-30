# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import pytest

from graph_caster.resilience import RecoveryAction, RecoveryManager
from graph_caster.resilience.checkpoint import CheckpointStore, RunCheckpoint


class TestRecoveryManager:
    @pytest.fixture
    def store(self, tmp_path):
        return CheckpointStore(tmp_path / "checkpoints.db")

    @pytest.fixture
    def manager(self, store):
        return RecoveryManager(store)

    def test_no_recovery_needed_for_new_run(self, manager):
        result = manager.check_recovery("new-run-id")
        assert result.action == RecoveryAction.NONE

    def test_recovery_needed_for_crashed_run(self, manager, store):
        checkpoint = RunCheckpoint(
            run_id="crashed-run",
            graph_id="graph-1",
            current_node_id="Task2",
            node_outputs={"Task1": {"done": True}},
            status="running",
            started_at="2026-03-30T10:00:00Z",
        )
        store.save(checkpoint)
        result = manager.check_recovery("crashed-run")
        assert result.action == RecoveryAction.RESUME
        assert result.checkpoint is not None
        assert result.checkpoint.current_node_id == "Task2"

    def test_no_recovery_for_completed_run(self, manager, store):
        checkpoint = RunCheckpoint(
            run_id="completed-run",
            graph_id="graph-1",
            current_node_id="Exit",
            node_outputs={"Task1": {"done": True}},
            status="completed",
            started_at="2026-03-30T10:00:00Z",
        )
        store.save(checkpoint)
        result = manager.check_recovery("completed-run")
        assert result.action == RecoveryAction.NONE

    def test_cleanup_completed_checkpoint(self, manager, store):
        checkpoint = RunCheckpoint(
            run_id="done-run",
            graph_id="graph-1",
            current_node_id="Exit",
            node_outputs={},
            status="completed",
            started_at="2026-03-30T10:00:00Z",
        )
        store.save(checkpoint)
        manager.cleanup("done-run")
        result = manager.check_recovery("done-run")
        assert result.action == RecoveryAction.NONE

    def test_list_recoverable_runs(self, manager, store):
        for i, status in enumerate(["running", "running", "completed"]):
            checkpoint = RunCheckpoint(
                run_id=f"run-{i}",
                graph_id="graph-1",
                current_node_id="Task1",
                node_outputs={},
                status=status,
                started_at="2026-03-30T10:00:00Z",
            )
            store.save(checkpoint)
        recoverable = manager.list_recoverable()
        assert len(recoverable) == 2
