# Copyright GraphCaster. All Rights Reserved.

"""Tests for F48 partial_exec.build_pinned_context."""

from __future__ import annotations

import asyncio
import json
import pytest
from pathlib import Path

from graph_caster.partial_exec import build_pinned_context, _compute_ancestors


# ---------------------------------------------------------------------------
# Helpers: minimal graph builder
# ---------------------------------------------------------------------------


def _make_chain_graph(node_ids: list[str], with_pins: list[str] | None = None) -> dict:
    """Build a simple linear graph: node_ids[0] -> node_ids[1] -> ... -> node_ids[-1].

    Each node is a 'task' node.  For nodes in *with_pins* a gcPin payload is added.
    """
    with_pins = with_pins or []
    nodes = []
    for nid in node_ids:
        data: dict = {}
        if nid in with_pins:
            data["gcPin"] = {
                "enabled": True,
                "payload": {
                    "processResult": {"exitCode": 0, "success": True, "stdout": f"output-{nid}"},
                },
            }
        nodes.append({"id": nid, "type": "task", "position": {"x": 0, "y": 0}, "data": data})

    edges = []
    for i in range(len(node_ids) - 1):
        edges.append({
            "id": f"e{i}",
            "source": node_ids[i],
            "target": node_ids[i + 1],
        })

    return {
        "meta": {"graphId": "test-chain"},
        "nodes": nodes,
        "edges": edges,
    }


# ---------------------------------------------------------------------------
# Unit tests: _compute_ancestors
# ---------------------------------------------------------------------------


class TestComputeAncestors:
    def test_single_node_no_ancestors(self) -> None:
        edges = [{"source": "A", "target": "B"}]
        ancs = _compute_ancestors("A", edges)
        assert ancs == set()

    def test_linear_chain_ancestors(self) -> None:
        edges = [
            {"source": "A", "target": "B"},
            {"source": "B", "target": "C"},
            {"source": "C", "target": "D"},
        ]
        assert _compute_ancestors("D", edges) == {"A", "B", "C"}
        assert _compute_ancestors("C", edges) == {"A", "B"}
        assert _compute_ancestors("B", edges) == {"A"}

    def test_diamond_ancestors(self) -> None:
        edges = [
            {"source": "A", "target": "B"},
            {"source": "A", "target": "C"},
            {"source": "B", "target": "D"},
            {"source": "C", "target": "D"},
        ]
        assert _compute_ancestors("D", edges) == {"A", "B", "C"}


# ---------------------------------------------------------------------------
# Integration tests: build_pinned_context
# ---------------------------------------------------------------------------


class TestBuildPinnedContext:
    """5-node chain A->B->C->D->E with A, B, C having gcPin."""

    @pytest.fixture
    def chain_graph(self) -> dict:
        return _make_chain_graph(["A", "B", "C", "D", "E"], with_pins=["A", "B", "C"])

    def test_start_at_D_uses_pins_abc(self, chain_graph: dict, tmp_path: Path) -> None:
        """build_pinned_context(start=D) returns context with A, B, C from pins."""

        async def run() -> None:
            ctx = await build_pinned_context(
                graph=chain_graph,
                start_node="D",
                use_pins=True,
                workspace_root=tmp_path,
            )
            node_outputs = ctx["node_outputs"]
            assert set(node_outputs.keys()) == {"A", "B", "C"}
            for nid in ("A", "B", "C"):
                assert node_outputs[nid]["processResult"]["success"] is True
                assert node_outputs[nid]["processResult"]["stdout"] == f"output-{nid}"

        asyncio.run(run())

    def test_start_at_B_use_pins_false_only_A_needed(
        self, chain_graph: dict, tmp_path: Path
    ) -> None:
        """start=B with use_pins=False -> A's pin cannot be used, fallback to empty."""

        async def run() -> None:
            ctx = await build_pinned_context(
                graph=chain_graph,
                start_node="B",
                use_pins=False,
                workspace_root=tmp_path,
            )
            node_outputs = ctx["node_outputs"]
            assert set(node_outputs.keys()) == {"A"}
            assert node_outputs["A"] == {}

        asyncio.run(run())

    def test_start_at_B_use_pins_true_a_from_pin(
        self, chain_graph: dict, tmp_path: Path
    ) -> None:
        """start=B with use_pins=True -> A from pin."""

        async def run() -> None:
            ctx = await build_pinned_context(
                graph=chain_graph,
                start_node="B",
                use_pins=True,
                workspace_root=tmp_path,
            )
            node_outputs = ctx["node_outputs"]
            assert set(node_outputs.keys()) == {"A"}
            assert node_outputs["A"]["processResult"]["stdout"] == "output-A"

        asyncio.run(run())

    def test_overrides_take_priority_over_pins(
        self, chain_graph: dict, tmp_path: Path
    ) -> None:
        """Overrides take priority over gcPin payloads."""

        async def run() -> None:
            overrides = {"A": {"processResult": {"exitCode": 99, "stdout": "overridden-A"}}}
            ctx = await build_pinned_context(
                graph=chain_graph,
                start_node="D",
                use_pins=True,
                workspace_root=tmp_path,
                overrides=overrides,
            )
            node_outputs = ctx["node_outputs"]
            assert node_outputs["A"]["processResult"]["exitCode"] == 99
            assert node_outputs["A"]["processResult"]["stdout"] == "overridden-A"
            assert node_outputs["B"]["processResult"]["stdout"] == "output-B"
            assert node_outputs["C"]["processResult"]["stdout"] == "output-C"

        asyncio.run(run())

    def test_from_run_id_loads_outputs(
        self, chain_graph: dict, tmp_path: Path
    ) -> None:
        """from_run_id loads node outputs from a previous run's events.ndjson."""
        run_id = "test-run-001"
        graph_id = "test-chain"

        run_dir = tmp_path / "runs" / graph_id / "2026-01-01T00-00-00"
        run_dir.mkdir(parents=True)

        (run_dir / "run-summary.json").write_text(
            json.dumps({"runId": run_id, "graphId": graph_id}),
            encoding="utf-8",
        )

        events = [
            {"type": "run_started", "runId": run_id},
            {
                "type": "node_outputs_snapshot",
                "runId": run_id,
                "nodeId": "A",
                "outputs": {"processResult": {"exitCode": 0, "stdout": "from-run-A"}},
            },
            {
                "type": "node_outputs_snapshot",
                "runId": run_id,
                "nodeId": "B",
                "outputs": {"processResult": {"exitCode": 0, "stdout": "from-run-B"}},
            },
        ]
        events_ndjson = "\n".join(json.dumps(e) for e in events)
        (run_dir / "events.ndjson").write_text(events_ndjson, encoding="utf-8")

        graph_no_pins = _make_chain_graph(["A", "B", "C", "D", "E"])

        async def run() -> None:
            ctx = await build_pinned_context(
                graph=graph_no_pins,
                start_node="C",
                use_pins=False,
                from_run_id=run_id,
                workspace_root=tmp_path,
            )
            node_outputs = ctx["node_outputs"]
            assert set(node_outputs.keys()) == {"A", "B"}
            assert node_outputs["A"]["processResult"]["stdout"] == "from-run-A"
            assert node_outputs["B"]["processResult"]["stdout"] == "from-run-B"

        asyncio.run(run())

    def test_from_run_id_overrides_override_run_output(
        self, chain_graph: dict, tmp_path: Path
    ) -> None:
        """Overrides take priority over from_run_id outputs."""
        run_id = "test-run-002"
        graph_id = "test-chain"

        run_dir = tmp_path / "runs" / graph_id / "2026-01-01T00-00-01"
        run_dir.mkdir(parents=True)
        (run_dir / "run-summary.json").write_text(
            json.dumps({"runId": run_id}), encoding="utf-8"
        )
        events = [
            {"type": "run_started", "runId": run_id},
            {
                "type": "node_outputs_snapshot",
                "runId": run_id,
                "nodeId": "A",
                "outputs": {"processResult": {"stdout": "from-run"}},
            },
        ]
        (run_dir / "events.ndjson").write_text(
            "\n".join(json.dumps(e) for e in events), encoding="utf-8"
        )

        graph_no_pins = _make_chain_graph(["A", "B", "C", "D", "E"])
        overrides = {"A": {"processResult": {"stdout": "override-wins"}}}

        async def run() -> None:
            ctx = await build_pinned_context(
                graph=graph_no_pins,
                start_node="B",
                use_pins=False,
                from_run_id=run_id,
                workspace_root=tmp_path,
                overrides=overrides,
            )
            assert ctx["node_outputs"]["A"]["processResult"]["stdout"] == "override-wins"

        asyncio.run(run())

    def test_start_at_first_node_has_no_ancestors(
        self, chain_graph: dict, tmp_path: Path
    ) -> None:
        """Starting at the first node requires no pinned context."""

        async def run() -> None:
            ctx = await build_pinned_context(
                graph=chain_graph,
                start_node="A",
                use_pins=True,
                workspace_root=tmp_path,
            )
            assert ctx["node_outputs"] == {}

        asyncio.run(run())
