# Copyright GraphCaster. All Rights Reserved.

"""Tests for F102 — deterministic trace replay."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

from graph_caster.replay import (
    ReplayError,
    ReplayManager,
    ReplayPlan,
    _compute_downstream,
    _find_first_incomplete_node,
    _reconstruct_node_outputs,
)


# ---------------------------------------------------------------------------
# Helpers: synthetic run fixture
# ---------------------------------------------------------------------------


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _write_events(run_dir: Path, events: list[dict]) -> None:
    events_path = run_dir / "events.ndjson"
    lines = [json.dumps(e, ensure_ascii=False) for e in events]
    events_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _write_summary(run_dir: Path, run_id: str, graph_id: str, status: str = "success") -> None:
    (run_dir / "run-summary.json").write_text(
        json.dumps({"runId": run_id, "graphId": graph_id, "status": status}),
        encoding="utf-8",
    )


def _make_graph_doc(
    graph_id: str,
    node_ids: list[str],
    edges: list[tuple[str, str]],
) -> dict:
    """Build a minimal graph JSON document."""
    nodes = [
        {"id": nid, "type": "task", "position": {"x": 0, "y": 0}, "data": {}}
        for nid in node_ids
    ]
    edges_list = [
        {
            "id": f"e_{src}_{tgt}",
            "source": src,
            "sourceHandle": "out_default",
            "target": tgt,
            "targetHandle": "in_default",
        }
        for src, tgt in edges
    ]
    return {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": graph_id, "title": "test"},
        "nodes": nodes,
        "edges": edges_list,
    }


def _make_complete_run(
    workspace: Path,
    graph_id: str,
    run_id: str,
    node_outputs: dict[str, Any],
    failed_node: str | None = None,
) -> Path:
    """
    Create a synthetic 4-node run under workspace/runs/<graphId>/<runDir>/.
    A→B→C→D with the given node outputs.
    If failed_node is set, that node gets ok=False in its step_finished.
    """
    run_dir = workspace / "runs" / graph_id / "20260101T000000_synth"
    run_dir.mkdir(parents=True, exist_ok=True)

    events: list[dict] = [
        {
            "type": "run_started",
            "runId": run_id,
            "timestamp": _iso(),
        }
    ]
    for i, (nid, output) in enumerate(node_outputs.items()):
        ok = nid != failed_node
        events.append(
            {
                "type": "step_started",
                "runId": run_id,
                "timestamp": _iso(),
                "nodeId": nid,
                "index": i * 2,
            }
        )
        events.append(
            {
                "type": "step_finished",
                "runId": run_id,
                "timestamp": _iso(),
                "nodeId": nid,
                "ok": ok,
                "output": output if ok else None,
                "index": i * 2 + 1,
            }
        )
    if failed_node and failed_node not in node_outputs:
        events.append(
            {
                "type": "step_started",
                "runId": run_id,
                "timestamp": _iso(),
                "nodeId": failed_node,
                "index": len(events),
            }
        )
        events.append(
            {
                "type": "step_finished",
                "runId": run_id,
                "timestamp": _iso(),
                "nodeId": failed_node,
                "ok": False,
                "output": None,
                "index": len(events),
            }
        )

    _write_events(run_dir, events)
    _write_summary(run_dir, run_id, graph_id)
    return run_dir


def _make_workspace(tmp_path: Path, graph_id: str) -> Path:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    graphs_dir = workspace / "graphs"
    graphs_dir.mkdir()
    graph_doc = _make_graph_doc(
        graph_id,
        node_ids=["A", "B", "C", "D"],
        edges=[("A", "B"), ("B", "C"), ("C", "D")],
    )
    (graphs_dir / "graph.json").write_text(
        json.dumps(graph_doc), encoding="utf-8"
    )
    return workspace


# ---------------------------------------------------------------------------
# Unit tests: helpers
# ---------------------------------------------------------------------------


class TestComputeDownstream:
    def test_linear_chain(self) -> None:
        edges = [
            {"source": "A", "target": "B"},
            {"source": "B", "target": "C"},
            {"source": "C", "target": "D"},
        ]
        assert _compute_downstream("C", edges) == {"C", "D"}

    def test_start_is_included(self) -> None:
        edges = [{"source": "A", "target": "B"}]
        result = _compute_downstream("A", edges)
        assert "A" in result
        assert "B" in result

    def test_no_outgoing_edges(self) -> None:
        edges: list = []
        assert _compute_downstream("X", edges) == {"X"}

    def test_branch_fan_out(self) -> None:
        edges = [
            {"source": "A", "target": "B"},
            {"source": "A", "target": "C"},
            {"source": "B", "target": "D"},
        ]
        assert _compute_downstream("A", edges) == {"A", "B", "C", "D"}


class TestReconstructNodeOutputs:
    def test_collects_successful_outputs(self, tmp_path: Path) -> None:
        run_id = "r1"
        run_dir = tmp_path / "run"
        run_dir.mkdir()
        _write_events(
            run_dir,
            [
                {
                    "type": "step_finished",
                    "runId": run_id,
                    "nodeId": "A",
                    "ok": True,
                    "output": {"result": 1},
                },
                {
                    "type": "step_finished",
                    "runId": run_id,
                    "nodeId": "B",
                    "ok": False,
                    "output": {"result": 2},
                },
            ],
        )
        outputs = _reconstruct_node_outputs(run_dir / "events.ndjson")
        assert "A" in outputs
        assert outputs["A"] == {"result": 1}
        assert "B" not in outputs  # ok=False

    def test_ignores_null_output(self, tmp_path: Path) -> None:
        run_dir = tmp_path / "run"
        run_dir.mkdir()
        _write_events(
            run_dir,
            [
                {
                    "type": "step_finished",
                    "runId": "r",
                    "nodeId": "X",
                    "ok": True,
                    "output": None,
                }
            ],
        )
        outputs = _reconstruct_node_outputs(run_dir / "events.ndjson")
        assert "X" not in outputs


class TestFindFirstIncompleteNode:
    def test_detects_failed_node(self, tmp_path: Path) -> None:
        run_dir = tmp_path / "run"
        run_dir.mkdir()
        _write_events(
            run_dir,
            [
                {"type": "step_started", "runId": "r", "nodeId": "A", "index": 0},
                {"type": "step_finished", "runId": "r", "nodeId": "A", "ok": True, "index": 1},
                {"type": "step_started", "runId": "r", "nodeId": "B", "index": 2},
                {"type": "step_finished", "runId": "r", "nodeId": "B", "ok": False, "index": 3},
            ],
        )
        node = _find_first_incomplete_node(run_dir / "events.ndjson", {"A", "B", "C"})
        assert node == "B"

    def test_detects_started_but_not_finished(self, tmp_path: Path) -> None:
        run_dir = tmp_path / "run"
        run_dir.mkdir()
        _write_events(
            run_dir,
            [
                {"type": "step_started", "runId": "r", "nodeId": "C", "index": 0},
            ],
        )
        node = _find_first_incomplete_node(run_dir / "events.ndjson", {"C", "D"})
        assert node == "C"

    def test_returns_none_when_all_complete(self, tmp_path: Path) -> None:
        run_dir = tmp_path / "run"
        run_dir.mkdir()
        _write_events(
            run_dir,
            [
                {"type": "step_started", "runId": "r", "nodeId": "A", "index": 0},
                {"type": "step_finished", "runId": "r", "nodeId": "A", "ok": True, "index": 1},
            ],
        )
        assert _find_first_incomplete_node(run_dir / "events.ndjson", {"A"}) is None


# ---------------------------------------------------------------------------
# Integration tests: ReplayManager.build_plan
# ---------------------------------------------------------------------------


class TestBuildPlan:
    """Tests for ReplayManager.build_plan."""

    def test_explicit_start_from(self, tmp_path: Path) -> None:
        graph_id = "g1"
        run_id = "run-explicit"
        workspace = _make_workspace(tmp_path, graph_id)
        _make_complete_run(
            workspace,
            graph_id,
            run_id,
            node_outputs={
                "A": {"result": 1},
                "B": {"result": 2},
                "C": {"result": 3},
                "D": {"result": 4},
            },
        )

        async def go() -> ReplayPlan:
            mgr = ReplayManager(workspace)
            return await mgr.build_plan(run_id, start_from="C")

        plan = asyncio.run(go())
        assert plan.run_id == run_id
        assert plan.graph_id == graph_id
        assert plan.start_from_node == "C"
        assert set(plan.replayed_nodes) == {"C", "D"}
        assert set(plan.skipped_nodes) == {"A", "B"}
        assert "A" in plan.pinned_outputs
        assert plan.pinned_outputs["A"] == {"result": 1}
        assert "B" in plan.pinned_outputs
        assert plan.pinned_outputs["B"] == {"result": 2}

    def test_auto_detect_first_failed_node(self, tmp_path: Path) -> None:
        graph_id = "g2"
        run_id = "run-autodetect"
        workspace = _make_workspace(tmp_path, graph_id)
        run_dir = workspace / "runs" / graph_id / "20260101T000000_synth"
        run_dir.mkdir(parents=True, exist_ok=True)
        # A and B succeeded; C failed
        _write_events(
            run_dir,
            [
                {"type": "run_started", "runId": run_id, "timestamp": _iso()},
                {"type": "step_started", "runId": run_id, "nodeId": "A", "index": 0},
                {
                    "type": "step_finished",
                    "runId": run_id,
                    "nodeId": "A",
                    "ok": True,
                    "output": {"v": 10},
                    "index": 1,
                },
                {"type": "step_started", "runId": run_id, "nodeId": "B", "index": 2},
                {
                    "type": "step_finished",
                    "runId": run_id,
                    "nodeId": "B",
                    "ok": True,
                    "output": {"v": 20},
                    "index": 3,
                },
                {"type": "step_started", "runId": run_id, "nodeId": "C", "index": 4},
                {
                    "type": "step_finished",
                    "runId": run_id,
                    "nodeId": "C",
                    "ok": False,
                    "output": None,
                    "index": 5,
                },
            ],
        )
        _write_summary(run_dir, run_id, graph_id)

        async def go() -> ReplayPlan:
            mgr = ReplayManager(workspace)
            return await mgr.build_plan(run_id)

        plan = asyncio.run(go())
        assert plan.start_from_node == "C"
        assert set(plan.skipped_nodes) == {"A", "B"}
        assert plan.pinned_outputs["A"] == {"v": 10}
        assert plan.pinned_outputs["B"] == {"v": 20}

    def test_override_modifies_pinned_output(self, tmp_path: Path) -> None:
        graph_id = "g3"
        run_id = "run-override"
        workspace = _make_workspace(tmp_path, graph_id)
        _make_complete_run(
            workspace,
            graph_id,
            run_id,
            node_outputs={
                "A": {"result": 41},
                "B": {"result": 2},
                "C": {"result": 3},
                "D": {"result": 4},
            },
            failed_node="C",
        )

        async def go() -> ReplayPlan:
            mgr = ReplayManager(workspace)
            return await mgr.build_plan(
                run_id,
                start_from="C",
                override_inputs={"A.result": 99},
            )

        plan = asyncio.run(go())
        assert plan.pinned_outputs["A"]["result"] == 99

    def test_run_not_found_raises_replay_error(self, tmp_path: Path) -> None:
        workspace = tmp_path / "ws"
        workspace.mkdir()
        (workspace / "graphs").mkdir()
        (workspace / "runs").mkdir()

        async def go() -> None:
            mgr = ReplayManager(workspace)
            await mgr.build_plan("nonexistent-run-id")

        with pytest.raises(ReplayError, match="Run not found"):
            asyncio.run(go())


# ---------------------------------------------------------------------------
# Integration tests: ReplayManager.execute (with mock runner)
# ---------------------------------------------------------------------------


class TestExecutePlan:
    """Tests for ReplayManager.execute with a mocked runner."""

    @staticmethod
    def _make_runner_factory(captured: dict) -> Any:
        """
        Return a runner_factory that records what it received and provides a
        minimal run_from method.
        """

        class FakeRunner:
            def __init__(self, doc: Any, *, sink: Any, host: Any, **kwargs: Any) -> None:
                captured["doc"] = doc
                captured["sink"] = sink

            def run_from(self, node_id: str, *, context: dict) -> None:
                captured["start_node"] = node_id
                captured["context"] = context

        return FakeRunner

    def test_execute_returns_new_run_id(self, tmp_path: Path) -> None:
        graph_id = "g-exec"
        run_id = "run-exec-orig"
        workspace = _make_workspace(tmp_path, graph_id)
        _make_complete_run(
            workspace,
            graph_id,
            run_id,
            node_outputs={
                "A": {"r": 1},
                "B": {"r": 2},
                "C": {"r": 3},
                "D": {"r": 4},
            },
        )

        captured: dict = {}
        factory = self._make_runner_factory(captured)

        async def go() -> str:
            mgr = ReplayManager(workspace, runner_factory=factory)
            plan = await mgr.build_plan(run_id, start_from="C")
            return await mgr.execute(plan, allow_non_idempotent=True)

        new_run_id = asyncio.run(go())
        assert new_run_id
        assert new_run_id != run_id
        assert captured["start_node"] == "C"

    def test_execute_prepopulates_node_outputs(self, tmp_path: Path) -> None:
        graph_id = "g-ctx"
        run_id = "run-ctx"
        workspace = _make_workspace(tmp_path, graph_id)
        _make_complete_run(
            workspace,
            graph_id,
            run_id,
            node_outputs={"A": {"r": 10}, "B": {"r": 20}, "C": {"r": 30}, "D": {"r": 40}},
        )

        captured: dict = {}
        factory = self._make_runner_factory(captured)

        async def go() -> None:
            mgr = ReplayManager(workspace, runner_factory=factory)
            plan = await mgr.build_plan(run_id, start_from="C")
            await mgr.execute(plan, allow_non_idempotent=True)

        asyncio.run(go())
        ctx = captured["context"]
        node_outs = ctx.get("node_outputs", {})
        assert node_outs.get("A") == {"r": 10}
        assert node_outs.get("B") == {"r": 20}
        assert "C" not in node_outs  # not pinned (it is replayed)

    def test_execute_applies_override_inputs(self, tmp_path: Path) -> None:
        graph_id = "g-ov"
        run_id = "run-ov"
        workspace = _make_workspace(tmp_path, graph_id)
        _make_complete_run(
            workspace,
            graph_id,
            run_id,
            node_outputs={"A": {"result": 41}, "B": {"result": 2}, "C": {"r": 3}, "D": {"r": 4}},
        )

        captured: dict = {}
        factory = self._make_runner_factory(captured)

        async def go() -> None:
            mgr = ReplayManager(workspace, runner_factory=factory)
            plan = await mgr.build_plan(run_id, start_from="C")
            await mgr.execute(
                plan,
                override_inputs={"A.result": 99},
                allow_non_idempotent=True,
            )

        asyncio.run(go())
        ctx = captured["context"]
        assert ctx["node_outputs"]["A"]["result"] == 99

    def test_execute_writes_replay_of_json(self, tmp_path: Path) -> None:
        graph_id = "g-meta"
        run_id = "run-meta"
        workspace = _make_workspace(tmp_path, graph_id)
        _make_complete_run(
            workspace,
            graph_id,
            run_id,
            node_outputs={"A": {"r": 1}, "B": {"r": 2}, "C": {"r": 3}, "D": {"r": 4}},
        )

        captured: dict = {}
        factory = self._make_runner_factory(captured)

        async def go() -> str:
            mgr = ReplayManager(workspace, runner_factory=factory)
            plan = await mgr.build_plan(run_id, start_from="C")
            return await mgr.execute(plan, allow_non_idempotent=True)

        new_run_id = asyncio.run(go())

        # Find the new run dir
        new_run_dirs = list((workspace / "runs" / graph_id).iterdir())
        assert len(new_run_dirs) == 2  # original + new
        for d in new_run_dirs:
            if d.name != "20260101T000000_synth":
                replay_meta_path = d / "replay-of.json"
                assert replay_meta_path.exists(), f"replay-of.json missing in {d}"
                meta = json.loads(replay_meta_path.read_text())
                assert meta["replayOf"] == run_id
                assert meta["startFromNode"] == "C"


# ---------------------------------------------------------------------------
# Dry-run: plan without executing
# ---------------------------------------------------------------------------


class TestDryRun:
    def test_build_plan_does_not_create_run_dir(self, tmp_path: Path) -> None:
        graph_id = "g-dry"
        run_id = "run-dry"
        workspace = _make_workspace(tmp_path, graph_id)
        _make_complete_run(
            workspace,
            graph_id,
            run_id,
            node_outputs={"A": {"r": 1}, "B": {"r": 2}, "C": {"r": 3}, "D": {"r": 4}},
        )

        async def go() -> ReplayPlan:
            mgr = ReplayManager(workspace)
            return await mgr.build_plan(run_id, start_from="C")

        plan = asyncio.run(go())
        assert plan.start_from_node == "C"

        # No new run dirs should have been created by build_plan alone
        existing_dirs = list((workspace / "runs" / graph_id).iterdir())
        assert len(existing_dirs) == 1


# ---------------------------------------------------------------------------
# ReplayPlan serialization
# ---------------------------------------------------------------------------


class TestReplayPlanToDict:
    def test_round_trip(self) -> None:
        plan = ReplayPlan(
            run_id="r1",
            graph_id="g1",
            graph_version=None,
            start_from_node="C",
            pinned_outputs={"A": {"x": 1}},
            replayed_nodes=["C", "D"],
            skipped_nodes=["A", "B"],
        )
        d = plan.to_dict()
        assert d["runId"] == "r1"
        assert d["graphId"] == "g1"
        assert d["graphVersion"] is None
        assert d["startFromNode"] == "C"
        assert d["pinnedOutputs"] == {"A": {"x": 1}}
        assert d["replayedNodes"] == ["C", "D"]
        assert d["skippedNodes"] == ["A", "B"]
