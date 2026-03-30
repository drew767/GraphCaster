# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from graph_caster.resilience.synthetic import (
    SyntheticEventReason,
    generate_synthetic_finish,
    generate_synthetic_node_finish,
)


class TestSyntheticEvents:
    def test_generate_synthetic_finish(self):
        event = generate_synthetic_finish(
            run_id="run-123",
            reason=SyntheticEventReason.WORKER_CRASH,
            last_node_id="Task3",
        )
        assert event["type"] == "run_finished"
        assert event["runId"] == "run-123"
        assert event["ok"] is False
        assert event["synthetic"] is True
        assert "WORKER_CRASH" in event["errorMessage"]

    def test_generate_synthetic_node_finish(self):
        event = generate_synthetic_node_finish(
            run_id="run-123",
            node_id="Task3",
            reason=SyntheticEventReason.TIMEOUT,
        )
        assert event["type"] == "step_finished"
        assert event["runId"] == "run-123"
        assert event["nodeId"] == "Task3"
        assert event["ok"] is False
        assert event["synthetic"] is True

    def test_synthetic_has_timestamp(self):
        event = generate_synthetic_finish(
            run_id="run-123",
            reason=SyntheticEventReason.WATCHDOG_TIMEOUT,
        )
        assert "timestamp" in event
        assert "20" in event["timestamp"]

    def test_synthetic_reasons(self):
        for reason in SyntheticEventReason:
            event = generate_synthetic_finish(run_id="run-123", reason=reason)
            assert reason.value in event["errorMessage"] or reason.name in event["errorMessage"]
