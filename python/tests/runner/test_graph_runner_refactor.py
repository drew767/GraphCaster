# Copyright GraphCaster. All Rights Reserved.

"""Tests for the GraphRunner refactor: removed thunks, helper splits, perf hooks."""

from __future__ import annotations

from typing import Any

from graph_caster.models import Edge, GraphDocument, Node
from graph_caster.runner.dispatch_tables import VISIT_BY_TYPE
from graph_caster.runner.graph_runner import (
    _MUTATING_NODE_TYPES,
    GraphRunner,
)


def _trivial_doc() -> GraphDocument:
    return GraphDocument(
        schema_version=1,
        graph_id="g",
        title="t",
        nodes=[
            Node(id="s", type="start", position={"x": 0, "y": 0}, data={}),
            Node(id="x", type="exit", position={"x": 200, "y": 0}, data={}),
        ],
        edges=[
            Edge(
                id="e1",
                source="s",
                source_handle="out_default",
                target="x",
                target_handle="in_default",
            ),
        ],
    )


class TestThunksRemoved:
    """The 16 ``_run_*_visit`` thunk methods on GraphRunner have been deleted."""

    def test_runner_has_no_visit_thunks(self) -> None:
        runner = GraphRunner(_trivial_doc(), sink=lambda _e: None)
        for kind in VISIT_BY_TYPE:
            attr = f"_run_{kind}_visit"
            assert not hasattr(runner, attr), f"{attr} should have been deleted"

    def test_runner_still_has_special_run_methods(self) -> None:
        """Non-thunk methods that wrap unique visit logic stay."""
        runner = GraphRunner(_trivial_doc(), sink=lambda _e: None)
        assert hasattr(runner, "_run_human_input_visit")
        assert hasattr(runner, "_run_from_execution_phase")


class TestMutatingNodeTypesSet:
    """Conservative copy-on-write set must cover all dispatch-routed types."""

    def test_all_visit_by_type_kinds_are_marked_mutating(self) -> None:
        for kind in VISIT_BY_TYPE:
            assert kind in _MUTATING_NODE_TYPES, (
                f"{kind} dispatches a visit that may write to ctx; mark it mutating"
            )

    def test_control_flow_types_that_mutate_are_included(self) -> None:
        for kind in ("mcp_tool", "graph_ref", "human_input", "fork", "merge", "ai_route"):
            assert kind in _MUTATING_NODE_TYPES


class TestForkPoolReuse:
    """The fork pool is created lazily and reused; ``close`` shuts it down."""

    def test_pool_created_on_demand(self) -> None:
        runner = GraphRunner(_trivial_doc(), sink=lambda _e: None)
        assert runner._fork_pool is None
        p = runner._ensure_fork_pool()
        assert p is not None
        assert runner._ensure_fork_pool() is p  # reused
        runner.close()
        assert runner._fork_pool is None

    def test_close_is_idempotent(self) -> None:
        runner = GraphRunner(_trivial_doc(), sink=lambda _e: None)
        runner._ensure_fork_pool()
        runner.close()
        runner.close()  # must not raise


class TestStructuralRulesCatalogCache:
    def test_cache_returns_same_instance(self) -> None:
        from graph_caster.structural_rules_engine import (
            invalidate_rules_catalog_cache,
            load_rules_catalog,
        )

        invalidate_rules_catalog_cache()
        a = load_rules_catalog()
        b = load_rules_catalog()
        assert a is b

    def test_invalidate_clears_cache(self) -> None:
        from graph_caster.structural_rules_engine import (
            invalidate_rules_catalog_cache,
            load_rules_catalog,
        )

        a = load_rules_catalog()
        invalidate_rules_catalog_cache()
        b = load_rules_catalog()
        # Different list instances after invalidation.
        assert a is not b


class TestAiRouteHoist:
    """``maxRequestJsonBytes`` / ``onFailure`` / ``fallbackChoiceIndex`` are resolved
    once at method entry, not on each iteration."""

    def test_helpers_exist(self) -> None:
        runner = GraphRunner(_trivial_doc(), sink=lambda _e: None)
        assert hasattr(runner, "_plan_ai_route_cache")
        assert hasattr(runner, "_execute_ai_route_request")
        assert hasattr(runner, "_emit_structural_warnings")
        assert hasattr(runner, "_dispatch_node_by_type")


class TestEndToEndSmoke:
    def test_start_to_exit_runs_clean(self) -> None:
        events: list[dict[str, Any]] = []
        GraphRunner(_trivial_doc(), sink=lambda e: events.append(e)).run(
            context={"last_result": True}
        )
        types = [e["type"] for e in events]
        assert "run_started" in types
        assert "run_success" in types
        assert "run_finished" in types
