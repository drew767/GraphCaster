# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import tempfile
import time
from pathlib import Path

import pytest

from graph_caster.resilience import (
    CheckpointStore,
    RecoveryManager,
    RunCheckpoint,
    SyntheticEventReason,
    WorkerWatchdog,
    generate_synthetic_finish,
)


class TestResilienceIntegration:
    @pytest.fixture
    def tmp_dir(self):
        with tempfile.TemporaryDirectory() as d:
            yield Path(d)

    @pytest.fixture
    def store(self, tmp_dir):
        s = CheckpointStore(tmp_dir / "checkpoints.db")
        try:
            yield s
        finally:
            s.close()

    @pytest.fixture
    def recovery(self, store):
        return RecoveryManager(store)

    def test_full_checkpoint_cycle(self, store, recovery):
        run_id = "test-run-1"
        checkpoint = RunCheckpoint(
            run_id=run_id,
            graph_id="graph-1",
            current_node_id="Start",
            node_outputs={},
            status="running",
            started_at="2026-03-30T10:00:00Z",
        )
        store.save(checkpoint)
        checkpoint.current_node_id = "Task1"
        checkpoint.node_outputs = {"Start": {"init": True}}
        store.save(checkpoint)
        result = recovery.check_recovery(run_id)
        assert result.action.name == "RESUME"
        assert result.checkpoint is not None
        assert result.checkpoint.current_node_id == "Task1"
        context = recovery.prepare_recovery(result.checkpoint)
        assert context["resume_from_node"] == "Task1"
        assert context["node_outputs"]["Start"]["init"] is True
        recovery.mark_completed(run_id)
        result = recovery.check_recovery(run_id)
        assert result.action.name == "NONE"

    def test_watchdog_triggers_synthetic_event(self, store, tmp_dir):
        events = []

        def on_dead(worker_id: str, run_id: str | None):
            events.append(
                generate_synthetic_finish(
                    run_id=run_id or "unknown",
                    reason=SyntheticEventReason.WATCHDOG_TIMEOUT,
                    last_node_id="Task3",
                )
            )

        watchdog = WorkerWatchdog(check_interval=0.05, on_worker_dead=on_dead)
        watchdog.register("worker-1", timeout=0.1, run_id="run-123")
        time.sleep(0.2)
        watchdog._check_workers()
        assert len(events) == 1
        assert events[0]["type"] == "run_finished"
        assert events[0]["synthetic"] is True
        assert events[0]["runId"] == "run-123"

    def test_recovery_from_multiple_crashes(self, store, recovery):
        run_id = "multi-crash-run"
        checkpoint = RunCheckpoint(
            run_id=run_id,
            graph_id="graph-1",
            current_node_id="Task1",
            node_outputs={},
            status="running",
            started_at="2026-03-30T10:00:00Z",
        )
        store.save(checkpoint)
        result = recovery.check_recovery(run_id)
        assert result.action.name == "RESUME"
        checkpoint.current_node_id = "Task2"
        checkpoint.node_outputs = {"Task1": {"done": True}}
        store.save(checkpoint)
        result = recovery.check_recovery(run_id)
        assert result.action.name == "RESUME"
        assert result.checkpoint is not None
        assert result.checkpoint.current_node_id == "Task2"
        recovery.mark_completed(run_id)
        result = recovery.check_recovery(run_id)
        assert result.action.name == "NONE"
