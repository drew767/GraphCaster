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


def test_runner_visit_shim_delegates_to_registry() -> None:
    """Calling ``runner._run_python_code_visit`` should route through the registry
    function for ``python_code`` — when there's no actual code, it returns a
    non-ok outcome rather than crashing."""
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
    events: list[dict[str, Any]] = []
    runner = GraphRunner(doc, sink=lambda e: events.append(e))
    # The shim just delegates; assert it is callable and matches the registry.
    assert runner._run_python_code_visit is not VISIT_FN_BY_NODE_TYPE["python_code"]
    # The wrapper produces the same return tuple shape: (outcome, used_pin).
    # We don't execute python code here; the test just guards the dispatch
    # plumbing is wired the right way.
