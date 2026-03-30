# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
from pathlib import Path

import pytest

from graph_caster.history.events import EventLogReader, EventType


class TestEventLogReader:
    @pytest.fixture
    def event_log(self, tmp_path: Path) -> Path:
        log_path = tmp_path / "runs" / "run-123" / "events.ndjson"
        log_path.parent.mkdir(parents=True)
        events = [
            {"type": "run_started", "runId": "run-123", "timestamp": "2026-03-30T10:00:00Z"},
            {
                "type": "step_started",
                "runId": "run-123",
                "nodeId": "Task1",
                "timestamp": "2026-03-30T10:00:01Z",
            },
            {
                "type": "step_finished",
                "runId": "run-123",
                "nodeId": "Task1",
                "ok": True,
                "timestamp": "2026-03-30T10:00:05Z",
            },
            {"type": "run_finished", "runId": "run-123", "ok": True, "timestamp": "2026-03-30T10:00:10Z"},
        ]
        log_path.write_text("\n".join(json.dumps(e) for e in events) + "\n", encoding="utf-8")
        return log_path

    def test_read_all_events(self, event_log: Path):
        reader = EventLogReader(event_log)
        events = list(reader.read_all())
        assert len(events) == 4
        assert events[0].type == EventType.RUN_STARTED
        assert events[-1].type == EventType.RUN_FINISHED

    def test_read_events_by_type(self, event_log: Path):
        reader = EventLogReader(event_log)
        step_events = list(reader.read_by_type([EventType.STEP_STARTED, EventType.STEP_FINISHED]))
        assert len(step_events) == 2

    def test_read_events_by_node(self, event_log: Path):
        reader = EventLogReader(event_log)
        task1_events = list(reader.read_by_node("Task1"))
        assert len(task1_events) == 2

    def test_read_events_range(self, event_log: Path):
        reader = EventLogReader(event_log)
        events = list(reader.read_range(start=1, end=3))
        assert len(events) == 2
        assert events[0].type == EventType.STEP_STARTED

    def test_count_events(self, event_log: Path):
        reader = EventLogReader(event_log)
        assert reader.count() == 4

    def test_get_event_by_index(self, event_log: Path):
        reader = EventLogReader(event_log)
        event = reader.get(2)
        assert event is not None
        assert event.type == EventType.STEP_FINISHED
        assert event.data.get("nodeId") == "Task1"
