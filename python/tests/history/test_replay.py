# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
from pathlib import Path

import pytest

from graph_caster.history.replay import EventReplayer


class TestEventReplayer:
    @pytest.fixture
    def event_log(self, tmp_path: Path) -> Path:
        log_path = tmp_path / "events.ndjson"
        events = [
            {"type": "run_started", "runId": "run-1", "timestamp": "2026-03-30T10:00:00Z"},
            {"type": "step_started", "runId": "run-1", "nodeId": "A", "timestamp": "2026-03-30T10:00:01Z"},
            {
                "type": "step_finished",
                "runId": "run-1",
                "nodeId": "A",
                "ok": True,
                "output": {"x": 1},
                "timestamp": "2026-03-30T10:00:02Z",
            },
            {"type": "step_started", "runId": "run-1", "nodeId": "B", "timestamp": "2026-03-30T10:00:03Z"},
            {
                "type": "step_finished",
                "runId": "run-1",
                "nodeId": "B",
                "ok": True,
                "output": {"y": 2},
                "timestamp": "2026-03-30T10:00:04Z",
            },
            {"type": "run_finished", "runId": "run-1", "ok": True, "timestamp": "2026-03-30T10:00:05Z"},
        ]
        log_path.write_text("\n".join(json.dumps(e) for e in events) + "\n", encoding="utf-8")
        return log_path

    def test_replay_step_by_step(self, event_log: Path):
        replayer = EventReplayer(event_log)
        state = replayer.step_forward()
        assert state.current_index == 0
        assert state.current_event is not None and state.current_event.type.value == "run_started"
        state = replayer.step_forward()
        assert state.current_index == 1
        assert state.node_states.get("A") == "running"

    def test_replay_to_index(self, event_log: Path):
        replayer = EventReplayer(event_log)
        state = replayer.go_to(3)
        assert state.current_index == 3
        assert state.node_states.get("A") == "completed"
        assert state.node_states.get("B") == "running"

    def test_replay_backward(self, event_log: Path):
        replayer = EventReplayer(event_log)
        replayer.go_to(4)
        state = replayer.step_backward()
        assert state.current_index == 3
        assert state.node_states.get("B") == "running"

    def test_get_node_output_at_index(self, event_log: Path):
        replayer = EventReplayer(event_log)
        replayer.go_to(4)
        assert replayer.get_node_output("A") == {"x": 1}
        assert replayer.get_node_output("B") == {"y": 2}

    def test_get_state_diff(self, event_log: Path):
        replayer = EventReplayer(event_log)
        replayer.go_to(2)
        replayer.go_to(4)
        diff = replayer.get_diff(2, 4)
        assert "B" in diff.added_nodes
        assert diff.changed_outputs.get("B") == {"y": 2}
