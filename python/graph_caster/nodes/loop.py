# Copyright GraphCaster. All Rights Reserved.

"""Loop node handler — condition or count-bounded iteration over a subgraph body."""

from __future__ import annotations

import json
from typing import Any

from graph_caster.models import Node

DEFAULT_MAX_ITERATIONS = 1000


def _eval_break_condition(condition: Any, state: Any, iteration: int, ctx: dict[str, Any]) -> bool:
    """Return True if the loop should break (condition met)."""
    if condition is None:
        return False
    if isinstance(condition, bool):
        return condition

    cond_str = str(condition).strip()
    if not cond_str:
        return False

    predicate_ctx: dict[str, Any] = dict(ctx)
    predicate_ctx["$loop"] = {"iter": iteration, "state": state}
    predicate_ctx["last_result"] = state

    try:
        if cond_str.startswith("{") or cond_str.startswith("{{"):
            from graph_caster.edge_conditions import eval_edge_condition
            return eval_edge_condition(cond_str, predicate_ctx)

        if "$" in cond_str:
            from graph_caster.runner.expression_conditions import (
                evaluate_edge_condition_inline,
                runner_predicate_to_expression_context,
            )
            expr_ctx = runner_predicate_to_expression_context(predicate_ctx)
            expr_ctx["$loop"] = {"iter": iteration, "state": state}
            return evaluate_edge_condition_inline(cond_str, expr_ctx)

        from graph_caster.edge_conditions import eval_edge_condition
        return eval_edge_condition(cond_str, predicate_ctx)
    except Exception:
        return False


def _collect_body_node_ids(runner: Any, loop_node_id: str) -> list[str]:
    ids: list[str] = []
    for n in runner._doc.nodes:
        if n.parentId == loop_node_id:
            ids.append(n.id)
    return ids


def execute_loop_node(
    runner: Any,
    node: Node,
    ctx: dict[str, Any],
) -> None:
    """Execute a `loop` node: iterate a subgraph body until a condition or cap.

    Termination: ``data.maxIterations`` hard cap OR ``data.breakCondition``
    evaluated after each iteration (true = break). Provides ``$loop.iter`` and
    ``$loop.state`` in expression context. Outputs ``state`` (final state).
    """
    data = dict(node.data) if node.data else {}

    max_iterations: int = int(data.get("maxIterations") or DEFAULT_MAX_ITERATIONS)
    break_condition: Any = data.get("breakCondition")

    initial_state_raw = data.get("initialState")
    if isinstance(initial_state_raw, dict):
        state: Any = dict(initial_state_raw)
    elif initial_state_raw is not None:
        state = initial_state_raw
    else:
        outs_map: dict[str, Any] = ctx.get("node_outputs") or {}
        state = ctx.get("last_result")
        if state is None:
            for pred_out in reversed(list(outs_map.values())):
                if pred_out is not None:
                    state = pred_out
                    break

    body_node_ids = _collect_body_node_ids(runner, node.id)

    iterations_completed = 0
    was_broken = False

    for iteration in range(max_iterations):
        if ctx.get("_run_cancelled"):
            break

        child_ctx = _build_loop_context(ctx, state, iteration)

        if body_node_ids:
            state = _run_body(runner, body_node_ids, child_ctx, state, iteration)
        else:
            state = {"iter": iteration, "state": state}

        iterations_completed = iteration + 1

        if _eval_break_condition(break_condition, state, iteration, ctx):
            was_broken = True
            break

    _store_output(runner, node, ctx, state, iterations_completed, was_broken)


def _build_loop_context(ctx: dict[str, Any], state: Any, iteration: int) -> dict[str, Any]:
    child = dict(ctx)
    child["$loop"] = {"iter": iteration, "state": state}
    child["last_result"] = state
    return child


def _run_body(
    runner: Any,
    body_node_ids: list[str],
    child_ctx: dict[str, Any],
    state: Any,
    iteration: int,
) -> Any:
    last_output: Any = state
    for nid in body_node_ids:
        node = runner._node_by_id.get(nid)
        if node is None:
            continue
        from graph_caster.runner.node_visits import run_subprocess_task_visit
        from graph_caster.step_queue import StepQueue
        sq = StepQueue(nid)
        run_subprocess_task_visit(runner, node, child_ctx, sq)
        outs = child_ctx.get("node_outputs") or {}
        out = outs.get(nid)
        if out is not None:
            last_output = out

    return last_output


def _store_output(
    runner: Any,
    node: Node,
    ctx: dict[str, Any],
    state: Any,
    iterations_completed: int,
    was_broken: bool,
) -> None:
    outs_map = ctx.setdefault("node_outputs", {})
    prev = outs_map.get(node.id) or {}
    if not isinstance(prev, dict):
        prev = {}
    prev = dict(prev)
    prev["state"] = state
    prev["iterationsCompleted"] = iterations_completed
    prev["wasBroken"] = was_broken
    outs_map[node.id] = prev
    ctx["last_result"] = state
