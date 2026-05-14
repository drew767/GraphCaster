# Copyright GraphCaster. All Rights Reserved.

"""Tests for the human_input node and pause/resume machinery (F45)."""

from __future__ import annotations

import asyncio
import json
import tempfile
from pathlib import Path
from typing import Any

import pytest

from graph_caster.models import Edge, GraphDocument, Node
from graph_caster.pause_resume import CheckpointStore, PauseCheckpoint, PauseException
from graph_caster.runner import GraphRunner


def _doc(nodes: list[dict], edges: list[dict] | None = None) -> GraphDocument:
    return GraphDocument.from_dict(
        {
            "schemaVersion": 1,
            "graphId": "test-hi-graph",
            "nodes": nodes,
            "edges": edges or [],
        }
    )


def _make_sink() -> tuple[list[dict], Any]:
    events: list[dict] = []

    def sink(ev: dict) -> None:
        events.append(ev)

    return events, sink


class TestPauseCheckpoint:
    def test_round_trip(self) -> None:
        cp = PauseCheckpoint(
            run_id="r1",
            graph_id="g1",
            paused_at_node="n_hi",
            node_outputs={"prev": {"nodeType": "task"}},
            prompt="Approve?",
            kind="approval",
            choices=None,
            schema=None,
            paused_at="2026-01-01T00:00:00+00:00",
            timeout_sec=60.0,
        )
        d = cp.to_dict()
        assert d["status"] == "paused"
        restored = PauseCheckpoint.from_dict(d)
        assert restored.run_id == cp.run_id
        assert restored.graph_id == cp.graph_id
        assert restored.kind == "approval"
        assert restored.timeout_sec == 60.0


class TestCheckpointStore:
    def test_save_and_load(self, tmp_path: Path) -> None:
        store = CheckpointStore(tmp_path)
        cp = PauseCheckpoint(
            run_id="run-abc",
            graph_id="g-test",
            paused_at_node="hi-node",
            node_outputs={"prev": {}},
            prompt="Enter text",
            kind="text",
            choices=None,
            schema=None,
            paused_at="2026-05-01T10:00:00+00:00",
        )
        asyncio.run(store.save(cp))

        loaded = asyncio.run(store.load("run-abc"))
        assert loaded is not None
        assert loaded.run_id == "run-abc"
        assert loaded.graph_id == "g-test"
        assert loaded.paused_at_node == "hi-node"
        assert loaded.prompt == "Enter text"

    def test_load_returns_none_when_missing(self, tmp_path: Path) -> None:
        store = CheckpointStore(tmp_path)
        result = asyncio.run(store.load("nonexistent-run-id"))
        assert result is None

    def test_list_paused(self, tmp_path: Path) -> None:
        store = CheckpointStore(tmp_path)
        for i in range(3):
            cp = PauseCheckpoint(
                run_id=f"run-{i}",
                graph_id="g-list",
                paused_at_node="hi",
                node_outputs={},
                prompt=f"Prompt {i}",
                kind="text",
                choices=None,
                schema=None,
                paused_at="2026-05-01T10:00:00+00:00",
            )
            asyncio.run(store.save(cp))

        items = asyncio.run(store.list_paused())
        assert len(items) == 3
        ids = {c.run_id for c in items}
        assert ids == {"run-0", "run-1", "run-2"}

    def test_delete_removes_checkpoint(self, tmp_path: Path) -> None:
        store = CheckpointStore(tmp_path)
        cp = PauseCheckpoint(
            run_id="run-del",
            graph_id="g-del",
            paused_at_node="hi",
            node_outputs={},
            prompt="del?",
            kind="text",
            choices=None,
            schema=None,
            paused_at="2026-05-01T10:00:00+00:00",
        )
        asyncio.run(store.save(cp))
        asyncio.run(store.delete("run-del"))
        assert asyncio.run(store.load("run-del")) is None


class TestRunnerPauseBehavior:
    def _build_graph_with_human_input(self) -> GraphDocument:
        return _doc(
            nodes=[
                {"id": "s1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {
                    "id": "hi1",
                    "type": "human_input",
                    "position": {"x": 200, "y": 0},
                    "data": {
                        "kind": "approval",
                        "prompt": "Do you approve?",
                        "timeoutSec": 0,
                    },
                },
                {"id": "e1", "type": "exit", "position": {"x": 400, "y": 0}, "data": {}},
            ],
            edges=[
                {"id": "e-s1-hi1", "source": "s1", "target": "hi1"},
                {"id": "e-hi1-e1", "source": "hi1", "target": "e1"},
            ],
        )

    def test_pause_on_human_input_node_saves_checkpoint(self, tmp_path: Path) -> None:
        """Runner pauses at human_input and checkpoint is written."""
        doc = self._build_graph_with_human_input()
        events, sink = _make_sink()

        runner = GraphRunner(
            doc,
            sink=sink,
            host=__import__("graph_caster.host_context", fromlist=["RunHostContext"]).RunHostContext(
                artifacts_base=tmp_path
            ),
            run_id="test-pause-run-1",
        )
        runner.run()

        event_types = [e["type"] for e in events]
        assert "human_input_required" in event_types
        assert "run_paused" in event_types
        assert "run_finished" not in event_types

        store = CheckpointStore(tmp_path)
        cp = asyncio.run(store.load("test-pause-run-1"))
        assert cp is not None
        assert cp.paused_at_node == "hi1"
        assert cp.kind == "approval"
        assert cp.prompt == "Do you approve?"

    def test_run_status_paused_in_events(self, tmp_path: Path) -> None:
        """run_paused event carries pausedAtNode."""
        doc = self._build_graph_with_human_input()
        events, sink = _make_sink()

        runner = GraphRunner(
            doc,
            sink=sink,
            host=__import__("graph_caster.host_context", fromlist=["RunHostContext"]).RunHostContext(
                artifacts_base=tmp_path
            ),
            run_id="test-pause-run-2",
        )
        runner.run()

        paused_events = [e for e in events if e["type"] == "run_paused"]
        assert len(paused_events) == 1
        ev = paused_events[0]
        assert ev.get("pausedAtNode") == "hi1"

    def test_resume_with_payload_continues_run(self, tmp_path: Path) -> None:
        """After resuming, node_outputs contains the human response and run_finished is success."""
        doc = self._build_graph_with_human_input()
        events1: list[dict] = []
        runner1 = GraphRunner(
            doc,
            sink=lambda e: events1.append(e),
            host=__import__("graph_caster.host_context", fromlist=["RunHostContext"]).RunHostContext(
                artifacts_base=tmp_path
            ),
            run_id="test-resume-run-1",
        )
        runner1.run()

        assert any(e["type"] == "run_paused" for e in events1)

        node_outputs_from_pause = {}
        for ev in events1:
            if ev.get("type") == "human_input_required":
                pass

        store = CheckpointStore(tmp_path)
        cp = asyncio.run(store.load("test-resume-run-1"))
        assert cp is not None

        node_outputs = dict(cp.node_outputs)
        node_outputs["hi1"] = {
            "nodeType": "human_input",
            "humanInput": {
                "value": True,
                "approved": True,
                "respondedAt": "2026-05-12T12:00:00+00:00",
                "respondedBy": "test-user",
                "timedOut": False,
            },
        }

        events2: list[dict] = []
        runner2 = GraphRunner(
            doc,
            sink=lambda e: events2.append(e),
            host=__import__("graph_caster.host_context", fromlist=["RunHostContext"]).RunHostContext(
                artifacts_base=tmp_path
            ),
            run_id="test-resume-run-1",
        )
        ctx = {"run_id": "test-resume-run-1", "node_outputs": node_outputs}
        runner2.run_from("hi1", context=ctx)

        finished = [e for e in events2 if e["type"] == "run_finished"]
        assert len(finished) == 1
        assert finished[0].get("status") == "success"

    def test_kind_choice_with_invalid_value_still_pauses(self, tmp_path: Path) -> None:
        """Choice validation is caller-side; the node still pauses cleanly."""
        doc = _doc(
            nodes=[
                {"id": "s1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
                {
                    "id": "hi1",
                    "type": "human_input",
                    "position": {"x": 200, "y": 0},
                    "data": {
                        "kind": "choice",
                        "prompt": "Pick one",
                        "choices": ["A", "B", "C"],
                    },
                },
            ],
            edges=[{"id": "e1", "source": "s1", "target": "hi1"}],
        )
        events, sink = _make_sink()
        runner = GraphRunner(
            doc,
            sink=sink,
            run_id="test-choice-pause",
        )
        runner.run()
        assert any(e["type"] == "human_input_required" for e in events)
        assert any(e["type"] == "run_paused" for e in events)
