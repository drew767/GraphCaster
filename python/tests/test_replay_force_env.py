# Copyright GraphCaster. All Rights Reserved.

"""Tests for replay opt-in surface: ``force=True`` kwarg and ``GC_REPLAY_FORCE`` env."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pytest

from graph_caster.replay import (
    REPLAY_FORCE_ENV,
    NON_IDEMPOTENT_NODE_KINDS,
    ReplayManager,
    ReplayUnsafeError,
    ReplayWouldDuplicateSideEffects,
)


# ---------------------------------------------------------------------------
# Workspace helpers (mirroring test_replay_guard.py)
# ---------------------------------------------------------------------------


def _iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _make_doc(
    nodes: list[dict[str, Any]],
    edges: list[tuple[str, str]],
    *,
    graph_id: str,
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


def _make_run(workspace: Path, graph_id: str, run_id: str, node_ids: list[str]) -> None:
    run_dir = workspace / "runs" / graph_id / f"{run_id}_dir"
    run_dir.mkdir(parents=True, exist_ok=True)
    _write_events(run_dir, run_id, node_ids)
    (run_dir / "run-summary.json").write_text(
        json.dumps({"runId": run_id, "graphId": graph_id, "status": "success"}),
        encoding="utf-8",
    )


class _FakeRunner:
    """Records run_from invocations without executing real nodes."""

    captured: dict[str, Any] = {}

    def __init__(self, doc: Any, *, sink: Any, host: Any, **kwargs: Any) -> None:
        type(self).captured["doc"] = doc

    def run_from(self, node_id: str, *, context: dict) -> None:
        type(self).captured["start_node"] = node_id
        type(self).captured["context"] = context


@pytest.fixture(autouse=True)
def _reset_runner_and_env(monkeypatch: pytest.MonkeyPatch) -> None:
    _FakeRunner.captured = {}
    monkeypatch.delenv(REPLAY_FORCE_ENV, raising=False)


# ---------------------------------------------------------------------------
# Force surface
# ---------------------------------------------------------------------------


def _risky_workspace(tmp_path: Path) -> tuple[Path, str]:
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
    ws = _make_workspace(tmp_path, graph_id, doc)
    _make_run(ws, graph_id, run_id, ["A", "B", "C"])
    return ws, run_id


class TestReplayForceSurface:
    def test_force_true_kwarg_proceeds_with_warning(
        self, tmp_path: Path, caplog: pytest.LogCaptureFixture
    ) -> None:
        ws, run_id = _risky_workspace(tmp_path)

        async def go() -> str:
            mgr = ReplayManager(ws, runner_factory=_FakeRunner)
            plan = await mgr.build_plan(run_id, start_from="B")
            return await mgr.execute(plan, force=True)

        with caplog.at_level(logging.WARNING, logger="graph_caster.replay"):
            new_run_id = asyncio.run(go())
        assert new_run_id
        assert _FakeRunner.captured["start_node"] == "B"

        warnings = [
            r for r in caplog.records
            if r.levelno >= logging.WARNING and "non-idempotent" in r.getMessage()
        ]
        assert warnings
        assert "B" in warnings[0].getMessage()
        assert "force=True" in warnings[0].getMessage()

    def test_env_force_proceeds_with_warning(
        self, tmp_path: Path, caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        ws, run_id = _risky_workspace(tmp_path)
        monkeypatch.setenv(REPLAY_FORCE_ENV, "1")

        async def go() -> str:
            mgr = ReplayManager(ws, runner_factory=_FakeRunner)
            plan = await mgr.build_plan(run_id, start_from="B")
            return await mgr.execute(plan)

        with caplog.at_level(logging.WARNING, logger="graph_caster.replay"):
            new_run_id = asyncio.run(go())
        assert new_run_id
        assert _FakeRunner.captured["start_node"] == "B"
        msgs = [r.getMessage() for r in caplog.records if r.levelno >= logging.WARNING]
        assert any("GC_REPLAY_FORCE=1" in m for m in msgs)

    def test_env_force_falsey_value_does_not_override(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        ws, run_id = _risky_workspace(tmp_path)
        monkeypatch.setenv(REPLAY_FORCE_ENV, "0")

        async def go() -> None:
            mgr = ReplayManager(ws, runner_factory=_FakeRunner)
            plan = await mgr.build_plan(run_id, start_from="B")
            await mgr.execute(plan)

        with pytest.raises(ReplayUnsafeError):
            asyncio.run(go())
        assert "start_node" not in _FakeRunner.captured

    def test_spec_alias_class_is_same(self) -> None:
        """``ReplayWouldDuplicateSideEffects`` is the spec name for the same class."""
        assert ReplayWouldDuplicateSideEffects is ReplayUnsafeError

    def test_spec_alias_catches_raised_exception(self, tmp_path: Path) -> None:
        ws, run_id = _risky_workspace(tmp_path)

        async def go() -> None:
            mgr = ReplayManager(ws, runner_factory=_FakeRunner)
            plan = await mgr.build_plan(run_id, start_from="B")
            await mgr.execute(plan)

        with pytest.raises(ReplayWouldDuplicateSideEffects):
            asyncio.run(go())

    def test_safe_graph_no_warning_emitted(
        self, tmp_path: Path, caplog: pytest.LogCaptureFixture
    ) -> None:
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
        ws = _make_workspace(tmp_path, graph_id, doc)
        _make_run(ws, graph_id, run_id, ["A", "B", "C"])

        async def go() -> str:
            mgr = ReplayManager(ws, runner_factory=_FakeRunner)
            plan = await mgr.build_plan(run_id, start_from="B")
            return await mgr.execute(plan)

        with caplog.at_level(logging.WARNING, logger="graph_caster.replay"):
            new_run_id = asyncio.run(go())
        assert new_run_id
        # No non-idempotent warning fired.
        msgs = [r.getMessage() for r in caplog.records if r.levelno >= logging.WARNING]
        assert not any("non-idempotent" in m for m in msgs)
