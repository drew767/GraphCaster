# Copyright GraphCaster. All Rights Reserved.

"""Unit tests for :mod:`graph_caster.runner.run_state_machine`.

Tests the lifecycle helpers in isolation — both pure helpers (variable merge)
and the lifecycle entry points via a real :class:`GraphRunner`, asserting the
expected run-event sequence shape.
"""

from __future__ import annotations

from typing import Any

from graph_caster.models import Edge, GraphDocument, Node
from graph_caster.runner import run_state_machine
from graph_caster.runner.graph_runner import GraphRunner


def test_merge_run_variables_from_node_output_adds_and_removes() -> None:
    ctx: dict[str, Any] = {"run_variables": {"a": 1, "b": 2}}
    ctx["node_outputs"] = {
        "n1": {
            "runVariables": {"b": 20, "c": 30},
            "runVariablesRemove": ["a"],
        }
    }
    run_state_machine.merge_run_variables_from_node_output(ctx, "n1")
    assert ctx["run_variables"] == {"b": 20, "c": 30}


def test_merge_run_variables_handles_snake_case_aliases() -> None:
    ctx: dict[str, Any] = {"run_variables": {"x": 1}}
    ctx["node_outputs"] = {
        "n1": {
            "run_variables": {"y": 2},
            "run_variables_remove": ["x"],
        }
    }
    run_state_machine.merge_run_variables_from_node_output(ctx, "n1")
    assert ctx["run_variables"] == {"y": 2}


def test_merge_run_variables_no_op_when_node_missing() -> None:
    ctx: dict[str, Any] = {"run_variables": {"a": 1}}
    ctx["node_outputs"] = {}
    run_state_machine.merge_run_variables_from_node_output(ctx, "missing")
    assert ctx["run_variables"] == {"a": 1}


def test_merge_run_variables_no_op_when_no_outputs_dict() -> None:
    ctx: dict[str, Any] = {"run_variables": {"a": 1}}
    # node_outputs absent entirely
    run_state_machine.merge_run_variables_from_node_output(ctx, "n1")
    assert ctx["run_variables"] == {"a": 1}


def _minimal_linear_doc() -> GraphDocument:
    """start -> exit graph; the smallest thing that exercises run lifecycle end-to-end."""
    return GraphDocument(
        schema_version=1,
        graph_id="g-test",
        title="state-machine test",
        nodes=[
            Node(id="start1", type="start", position={"x": 0, "y": 0}, data={}),
            Node(id="exit1", type="exit", position={"x": 100, "y": 0}, data={}),
        ],
        edges=[
            Edge(
                id="e1",
                source="start1",
                source_handle="out_default",
                target="exit1",
                target_handle="in_default",
            )
        ],
    )


def test_run_emits_started_and_finished_for_root_run() -> None:
    doc = _minimal_linear_doc()
    events: list[dict[str, Any]] = []
    GraphRunner(doc, sink=lambda e: events.append(e)).run(context={"last_result": True})
    types = [e["type"] for e in events]
    assert types[0] == "run_started"
    assert "run_success" in types
    assert types[-1] == "run_finished"
    assert events[-1]["status"] == "success"


def test_run_from_assigns_run_id_when_missing() -> None:
    doc = _minimal_linear_doc()
    events: list[dict[str, Any]] = []
    runner = GraphRunner(doc, sink=lambda e: events.append(e))
    assert runner._run_id is None
    runner.run(context={"last_result": True})
    # after running the runner should have stamped a normalised run id
    assert runner._run_id is not None
    assert len(str(runner._run_id)) > 0
    # all events carry that run id
    rids = {e.get("runId") for e in events if "runId" in e}
    assert rids == {runner._run_id}


def test_run_state_machine_module_exposes_lifecycle_functions() -> None:
    """The module is the orchestration surface — these names must remain stable."""
    assert callable(run_state_machine.run)
    assert callable(run_state_machine.run_from)
    assert callable(run_state_machine.run_from_execution_phase)
    assert callable(run_state_machine.run_from_root_finally)
    assert callable(run_state_machine.execute_graph_ref)
    assert callable(run_state_machine.merge_run_variables_from_node_output)
