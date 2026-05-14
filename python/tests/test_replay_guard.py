# Copyright GraphCaster. All Rights Reserved.

"""Tests for replay safety guard: NON_IDEMPOTENT_NODE_KINDS, analyze_replay_safety,
ReplayUnsafeError, and ReplayManager.execute(allow_non_idempotent=...)."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pytest

from graph_caster.replay import (
    NON_IDEMPOTENT_NODE_KINDS,
    ReplayManager,
    ReplayUnsafeError,
    analyze_replay_safety,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _make_doc(
    nodes: list[dict[str, Any]],
    edges: list[tuple[str, str]],
    *,
    graph_id: str = "g",
) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": graph_id, "title": "t"},
        "nodes": nodes,
        "edges": [
            {
                "id": f"e_{s}_{t}",
                "source": s,
                "sourceHandle": "out_default",
                "target": t,
                "targetHandle": "in_default",
            }
            for s, t in edges
        ],
    }


def _node(nid: str, kind: str) -> dict[str, Any]:
    return {"id": nid, "type": kind, "position": {"x": 0, "y": 0}, "data": {}}


def _write_events(run_dir: Path, run_id: str, node_ids: list[str]) -> None:
    events: list[dict[str, Any]] = [
        {"type": "run_started", "runId": run_id, "timestamp": _iso()}
    ]
    for i, nid in enumerate(node_ids):
        events.append(
            {"type": "step_started", "runId": run_id, "nodeId": nid, "index": 2 * i}
        )
        events.append(
            {
                "type": "step_finished",
                "runId": run_id,
                "nodeId": nid,
                "ok": True,
                "output": {"v": i},
                "index": 2 * i + 1,
            }
        )
    (run_dir / "events.ndjson").write_text(
        "\n".join(json.dumps(e) for e in events) + "\n", encoding="utf-8"
    )


def _make_workspace(tmp_path: Path, graph_id: str, doc: dict[str, Any]) -> Path:
    ws = tmp_path / "workspace"
    ws.mkdir()
    (ws / "graphs").mkdir()
    (ws / "graphs" / f"{graph_id}.json").write_text(json.dumps(doc), encoding="utf-8")
    return ws


def _make_run(
    workspace: Path,
    graph_id: str,
    run_id: str,
    node_ids: list[str],
) -> None:
    run_dir = workspace / "runs" / graph_id / f"{run_id}_dir"
    run_dir.mkdir(parents=True, exist_ok=True)
    _write_events(run_dir, run_id, node_ids)
    (run_dir / "run-summary.json").write_text(
        json.dumps({"runId": run_id, "graphId": graph_id, "status": "success"}),
        encoding="utf-8",
    )


# ---------------------------------------------------------------------------
# Unit tests: NON_IDEMPOTENT_NODE_KINDS + analyze_replay_safety
# ---------------------------------------------------------------------------


class TestNonIdempotentKinds:
    def test_set_contents(self) -> None:
        # Sanity: critical side-effecting kinds are present.
        for k in (
            "http_request",
            "api_call",
            "llm",
            "llm_agent",
            "mcp_tool",
            "code",
            "python_code",
            "task",
            "trigger_webhook",
        ):
            assert k in NON_IDEMPOTENT_NODE_KINDS

    def test_set_is_frozen(self) -> None:
        assert isinstance(NON_IDEMPOTENT_NODE_KINDS, frozenset)


class TestAnalyzeReplaySafety:
    def test_safe_graph_returns_empty(self) -> None:
        doc = _make_doc(
            [
                _node("A", "start"),
                _node("B", "set_variable"),
                _node("C", "exit"),
            ],
            [("A", "B"), ("B", "C")],
        )
        assert analyze_replay_safety(doc) == []

    def test_risky_http_node_detected(self) -> None:
        doc = _make_doc(
            [
                _node("A", "start"),
                _node("B", "http_request"),
                _node("C", "exit"),
            ],
            [("A", "B"), ("B", "C")],
        )
        assert analyze_replay_safety(doc) == ["B"]

    def test_only_reachable_from_start_node_considered(self) -> None:
        doc = _make_doc(
            [
                _node("A", "start"),
                _node("B", "set_variable"),
                _node("C", "exit"),
                _node("X", "http_request"),  # orphan — unreachable from start
            ],
            [("A", "B"), ("B", "C")],
        )
        assert analyze_replay_safety(doc) == []

    def test_from_node_id_restricts_scope(self) -> None:
        doc = _make_doc(
            [
                _node("A", "start"),
                _node("B", "http_request"),
                _node("C", "set_variable"),
                _node("D", "llm"),
            ],
            [("A", "B"), ("B", "C"), ("C", "D")],
        )
        # Replaying only from C onwards: B is upstream and skipped, only D is risky.
        assert analyze_replay_safety(doc, from_node_id="C") == ["D"]

    def test_kind_field_fallback(self) -> None:
        doc = {
            "nodes": [
                {"id": "A", "type": "start", "data": {}},
                {"id": "B", "kind": "api_call", "data": {}},
            ],
            "edges": [{"source": "A", "target": "B"}],
        }
        assert analyze_replay_safety(doc) == ["B"]


# ---------------------------------------------------------------------------
# Integration: ReplayManager.execute safety gating
# ---------------------------------------------------------------------------


class _FakeRunner:
    """Captures run_from invocations without executing real nodes."""

    captured: dict[str, Any] = {}

    def __init__(self, doc: Any, *, sink: Any, host: Any, **kwargs: Any) -> None:
        type(self).captured["doc"] = doc
        type(self).captured["sink"] = sink

    def run_from(self, node_id: str, *, context: dict) -> None:
        type(self).captured["start_node"] = node_id
        type(self).captured["context"] = context


@pytest.fixture(autouse=True)
def _reset_fake_runner() -> None:
    _FakeRunner.captured = {}


class TestReplayExecuteSafety:
    def test_safe_graph_replays_without_flag(self, tmp_path: Path) -> None:
        graph_id = "g-safe"
        run_id = "run-safe"
        doc = _make_doc(
            [
                _node("A", "start"),
                _node("B", "set_variable"),
                _node("C", "exit"),
            ],
            [("A", "B"), ("B", "C")],
            graph_id=graph_id,
        )
        workspace = _make_workspace(tmp_path, graph_id, doc)
        _make_run(workspace, graph_id, run_id, ["A", "B", "C"])

        async def go() -> str:
            mgr = ReplayManager(workspace, runner_factory=_FakeRunner)
            plan = await mgr.build_plan(run_id, start_from="B")
            return await mgr.execute(plan)

        new_run_id = asyncio.run(go())
        assert new_run_id
        assert _FakeRunner.captured["start_node"] == "B"

    def test_risky_graph_raises_without_flag(self, tmp_path: Path) -> None:
        graph_id = "g-risky"
        run_id = "run-risky"
        doc = _make_doc(
            [
                _node("A", "start"),
                _node("B", "http_request"),
                _node("C", "exit"),
            ],
            [("A", "B"), ("B", "C")],
            graph_id=graph_id,
        )
        workspace = _make_workspace(tmp_path, graph_id, doc)
        _make_run(workspace, graph_id, run_id, ["A", "B", "C"])

        async def go() -> None:
            mgr = ReplayManager(workspace, runner_factory=_FakeRunner)
            plan = await mgr.build_plan(run_id, start_from="B")
            await mgr.execute(plan)

        with pytest.raises(ReplayUnsafeError) as exc:
            asyncio.run(go())

        assert "B" in exc.value.risky_node_ids
        assert "allow_non_idempotent=True" in str(exc.value)
        # Runner must not have been invoked
        assert "start_node" not in _FakeRunner.captured

    def test_risky_graph_replays_with_flag_and_logs_warning(
        self, tmp_path: Path, caplog: pytest.LogCaptureFixture
    ) -> None:
        graph_id = "g-allow"
        run_id = "run-allow"
        doc = _make_doc(
            [
                _node("A", "start"),
                _node("B", "llm"),
                _node("C", "exit"),
            ],
            [("A", "B"), ("B", "C")],
            graph_id=graph_id,
        )
        workspace = _make_workspace(tmp_path, graph_id, doc)
        _make_run(workspace, graph_id, run_id, ["A", "B", "C"])

        async def go() -> str:
            mgr = ReplayManager(workspace, runner_factory=_FakeRunner)
            plan = await mgr.build_plan(run_id, start_from="B")
            return await mgr.execute(plan, allow_non_idempotent=True)

        with caplog.at_level(logging.WARNING, logger="graph_caster.replay"):
            new_run_id = asyncio.run(go())

        assert new_run_id
        assert _FakeRunner.captured["start_node"] == "B"

        warnings = [
            r for r in caplog.records
            if r.levelno >= logging.WARNING and "non-idempotent" in r.getMessage()
        ]
        assert warnings, "expected a WARNING enumerating non-idempotent nodes"
        assert "B" in warnings[0].getMessage()
