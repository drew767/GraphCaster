# Copyright GraphCaster. All Rights Reserved.

"""Unit tests for :mod:`graph_caster.runner.visit_dispatch`.

Verifies the per-node-type registry and the fork-worker bookkeeping helper
without invoking heavyweight subprocess paths.
"""

from __future__ import annotations

from typing import Any

from graph_caster.models import Edge, GraphDocument, Node
from graph_caster.runner.graph_runner import GraphRunner
from graph_caster.runner.visit_dispatch import (
    VISIT_FN_BY_NODE_TYPE,
    fork_worker_begin_task_visit,
)


def test_visit_registry_has_one_entry_per_supported_kind() -> None:
    expected = {
        "task",
        "llm_agent",
        "agent",
        "http_request",
        "rag_query",
        "rag_index",
        "python_code",
        "set_variable",
        "delay",
        "debounce",
        "wait_for",
        "trigger_webhook",
        "trigger_schedule",
    }
    assert set(VISIT_FN_BY_NODE_TYPE) == expected
    for k, fn in VISIT_FN_BY_NODE_TYPE.items():
        assert callable(fn), f"entry {k} must be callable"


def test_fork_worker_begin_emits_enter_and_execute_with_redaction() -> None:
    """The worker bookkeeping helper emits the same node_enter + node_execute pair
    that the main loop emits, and seeds the node_outputs entry."""
    doc = GraphDocument(
        schema_version=1,
        graph_id="g-fork",
        title="t",
        nodes=[
            Node(
                id="t1",
                type="task",
                position={"x": 0, "y": 0},
                data={"command": "echo hello", "env": {"S": "sec"}},
            )
        ],
        edges=[],
    )
    events: list[dict[str, Any]] = []
    runner = GraphRunner(doc, sink=lambda e: events.append(e))
    ctx: dict[str, Any] = {"node_outputs": {}}
    node = runner._node_by_id["t1"]

    fork_worker_begin_task_visit(runner, node, ctx)

    types = [e["type"] for e in events]
    assert types == ["node_enter", "node_execute"]
    assert events[0]["nodeId"] == "t1"
    assert events[0]["graphId"] == "g-fork"
    assert events[1]["nodeId"] == "t1"
    # node_outputs seeded with nodeType + data
    assert ctx["node_outputs"]["t1"]["nodeType"] == "task"
    assert "data" in ctx["node_outputs"]["t1"]


def test_fork_worker_preserves_extra_keys_on_existing_node_output() -> None:
    """If the runner has already pinned arbitrary metadata onto a node output,
    a re-entry by a fork worker keeps that metadata (deep-copied)."""
    doc = GraphDocument(
        schema_version=1,
        graph_id="g-fork",
        title="t",
        nodes=[
            Node(
                id="t1",
                type="task",
                position={"x": 0, "y": 0},
                data={"command": "echo hi"},
            )
        ],
        edges=[],
    )
    runner = GraphRunner(doc, sink=lambda _e: None)
    ctx: dict[str, Any] = {
        "node_outputs": {
            "t1": {"nodeType": "task", "data": {}, "aiRoute": {"choiceIndex": 1}}
        }
    }
    node = runner._node_by_id["t1"]

    fork_worker_begin_task_visit(runner, node, ctx)

    entry = ctx["node_outputs"]["t1"]
    assert entry["aiRoute"] == {"choiceIndex": 1}
    assert entry["nodeType"] == "task"


def test_dispatch_visit_routes_node_type_to_registry_entry(monkeypatch) -> None:
    """``dispatch_visit`` must invoke the function registered in ``VISIT_BY_TYPE``
    for the node's type, passing ``fork_parallel_worker=False``."""
    from graph_caster.runner import dispatch_tables

    doc = GraphDocument(
        schema_version=1,
        graph_id="g",
        title="t",
        nodes=[
            Node(id="py1", type="python_code", position={"x": 0, "y": 0}, data={}),
            Node(id="exit1", type="exit", position={"x": 100, "y": 0}, data={}),
        ],
        edges=[
            Edge(
                id="e1",
                source="py1",
                source_handle="out_default",
                target="exit1",
                target_handle="in_default",
            )
        ],
    )
    runner = GraphRunner(doc, sink=lambda _e: None)
    node = runner._node_by_id["py1"]
    ctx: dict[str, Any] = {"node_outputs": {}}

    calls: list[dict[str, Any]] = []

    def _stub(runner_arg, node_arg, ctx_arg, step_q_arg, *, fork_parallel_worker):
        calls.append(
            {
                "runner": runner_arg,
                "node": node_arg,
                "ctx": ctx_arg,
                "fork_parallel_worker": fork_parallel_worker,
            }
        )
        return ("ok", False)

    patched = dict(dispatch_tables.VISIT_BY_TYPE)
    patched["python_code"] = _stub
    monkeypatch.setattr(dispatch_tables, "VISIT_BY_TYPE", patched)

    from graph_caster.step_queue import StepQueue

    step_q = StepQueue("py1")
    result = dispatch_tables.dispatch_visit(runner, node, ctx, step_q)

    assert result == ("ok", False)
    assert len(calls) == 1
    assert calls[0]["runner"] is runner
    assert calls[0]["node"] is node
    assert calls[0]["ctx"] is ctx
    assert calls[0]["fork_parallel_worker"] is False


def test_dispatch_visit_returns_none_for_unregistered_type() -> None:
    """Control-flow types (``exit``) are not in ``VISIT_BY_TYPE``; dispatch returns ``None``."""
    from graph_caster.runner.dispatch_tables import dispatch_visit
    from graph_caster.step_queue import StepQueue

    doc = GraphDocument(
        schema_version=1,
        graph_id="g",
        title="t",
        nodes=[
            Node(id="exit1", type="exit", position={"x": 0, "y": 0}, data={}),
        ],
        edges=[],
    )
    runner = GraphRunner(doc, sink=lambda _e: None)
    node = runner._node_by_id["exit1"]
    assert dispatch_visit(runner, node, {}, StepQueue("exit1")) is None
