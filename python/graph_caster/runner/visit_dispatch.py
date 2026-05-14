# Copyright GraphCaster. All Rights Reserved.

"""Per-node-type visit dispatch and fork-parallel worker.

Three layers sit here:

* ``VISIT_FN_BY_NODE_TYPE`` — map of node-type → :mod:`graph_caster.runner.node_visits`
  function. The runner-level ``_run_*_visit`` methods are thin wrappers; this
  dict centralises the routing for fork-parallel workers and any new caller.
* :func:`fork_worker_begin_task_visit` — common ``node_enter`` + ``node_execute``
  bookkeeping that fork-parallel workers do *before* calling into a typed
  visit (regular dispatch handles this inside the main loop).
* :func:`fork_parallel_branch_worker` — the per-thread body for a single
  :class:`ForkBranchPlan` branch.
"""

from __future__ import annotations

import copy
from typing import Any, Literal

from graph_caster.fork_parallel import ForkBranchPlan
from graph_caster.models import Node
from graph_caster.process_exec import redact_task_data_for_node_execute
from graph_caster.runner.node_visits import (
    run_agent_visit,
    run_debounce_visit,
    run_delay_visit,
    run_http_request_visit,
    run_llm_agent_visit,
    run_python_code_visit,
    run_rag_index_visit,
    run_rag_query_visit,
    run_set_variable_visit,
    run_subprocess_task_visit,
    run_trigger_schedule_visit,
    run_trigger_webhook_visit,
    run_wait_for_visit,
)
from graph_caster.runner.run_helpers import (
    agent_has_executable_config,
    delay_has_duration,
    debounce_has_duration,
    http_request_has_url,
    llm_agent_has_executable_command,
    python_code_has_code,
    rag_index_has_valid_config,
    rag_query_has_url_and_query,
    set_variable_has_valid_config,
    task_has_process_command,
    wait_for_has_executable_config,
)
from graph_caster.step_queue import StepQueue

VisitOutcome = tuple[Literal["ok", "continue", "break"], bool]


def _visit_subprocess_task(runner: Any, node: Node, ctx: dict[str, Any], step_q: StepQueue, *, fork_parallel_worker: bool) -> VisitOutcome:
    return run_subprocess_task_visit(runner, node, ctx, step_q, fork_parallel_worker=fork_parallel_worker)


def _visit_llm_agent(runner: Any, node: Node, ctx: dict[str, Any], step_q: StepQueue, *, fork_parallel_worker: bool) -> VisitOutcome:
    return run_llm_agent_visit(runner, node, ctx, step_q, fork_parallel_worker=fork_parallel_worker)


def _visit_agent(runner: Any, node: Node, ctx: dict[str, Any], step_q: StepQueue, *, fork_parallel_worker: bool) -> VisitOutcome:
    return run_agent_visit(runner, node, ctx, step_q, fork_parallel_worker=fork_parallel_worker)


def _visit_http_request(runner: Any, node: Node, ctx: dict[str, Any], step_q: StepQueue, *, fork_parallel_worker: bool) -> VisitOutcome:
    return run_http_request_visit(runner, node, ctx, step_q, fork_parallel_worker=fork_parallel_worker)


def _visit_rag_query(runner: Any, node: Node, ctx: dict[str, Any], step_q: StepQueue, *, fork_parallel_worker: bool) -> VisitOutcome:
    return run_rag_query_visit(runner, node, ctx, step_q, fork_parallel_worker=fork_parallel_worker)


def _visit_rag_index(runner: Any, node: Node, ctx: dict[str, Any], step_q: StepQueue, *, fork_parallel_worker: bool) -> VisitOutcome:
    return run_rag_index_visit(runner, node, ctx, step_q, fork_parallel_worker=fork_parallel_worker)


def _visit_python_code(runner: Any, node: Node, ctx: dict[str, Any], step_q: StepQueue, *, fork_parallel_worker: bool) -> VisitOutcome:
    return run_python_code_visit(runner, node, ctx, step_q, fork_parallel_worker=fork_parallel_worker)


def _visit_set_variable(runner: Any, node: Node, ctx: dict[str, Any], step_q: StepQueue, *, fork_parallel_worker: bool) -> VisitOutcome:
    return run_set_variable_visit(runner, node, ctx, step_q, fork_parallel_worker=fork_parallel_worker)


def _visit_delay(runner: Any, node: Node, ctx: dict[str, Any], step_q: StepQueue, *, fork_parallel_worker: bool) -> VisitOutcome:
    return run_delay_visit(runner, node, ctx, step_q, fork_parallel_worker=fork_parallel_worker)


def _visit_debounce(runner: Any, node: Node, ctx: dict[str, Any], step_q: StepQueue, *, fork_parallel_worker: bool) -> VisitOutcome:
    return run_debounce_visit(runner, node, ctx, step_q, fork_parallel_worker=fork_parallel_worker)


def _visit_wait_for(runner: Any, node: Node, ctx: dict[str, Any], step_q: StepQueue, *, fork_parallel_worker: bool) -> VisitOutcome:
    return run_wait_for_visit(runner, node, ctx, step_q, fork_parallel_worker=fork_parallel_worker)


def _visit_trigger_webhook(runner: Any, node: Node, ctx: dict[str, Any], step_q: StepQueue, *, fork_parallel_worker: bool) -> VisitOutcome:
    return run_trigger_webhook_visit(runner, node, ctx, step_q, fork_parallel_worker=fork_parallel_worker)


def _visit_trigger_schedule(runner: Any, node: Node, ctx: dict[str, Any], step_q: StepQueue, *, fork_parallel_worker: bool) -> VisitOutcome:
    return run_trigger_schedule_visit(runner, node, ctx, step_q, fork_parallel_worker=fork_parallel_worker)


# Public registry: keyed by node.type. Each value takes the runner first.
VISIT_FN_BY_NODE_TYPE: dict[str, Any] = {
    "task": _visit_subprocess_task,  # callers must also gate on task_has_process_command
    "llm_agent": _visit_llm_agent,
    "agent": _visit_agent,
    "http_request": _visit_http_request,
    "rag_query": _visit_rag_query,
    "rag_index": _visit_rag_index,
    "python_code": _visit_python_code,
    "set_variable": _visit_set_variable,
    "delay": _visit_delay,
    "debounce": _visit_debounce,
    "wait_for": _visit_wait_for,
    "trigger_webhook": _visit_trigger_webhook,
    "trigger_schedule": _visit_trigger_schedule,
}


def fork_worker_begin_task_visit(runner: Any, node: Node, ctx: dict[str, Any]) -> None:
    """Emit ``node_enter`` + ``node_execute`` and seed the per-node output entry.

    The main dispatch loop does this inline for non-fork-parallel nodes. Workers
    spawned by :func:`fork_parallel_branch_worker` have to perform the same
    bookkeeping themselves before invoking the typed visit body, because they
    aren't run from the StepQueue loop.
    """
    red_task = redact_task_data_for_node_execute(node.data)
    exec_data = red_task
    stored_node_data = dict(node.data) if red_task is node.data else red_task
    runner.emit("node_enter", nodeId=node.id, nodeType=node.type, graphId=runner._doc.graph_id)
    runner.emit("node_execute", nodeId=node.id, nodeType=node.type, data=exec_data)
    outs_map = ctx.setdefault("node_outputs", {})
    prev_out = outs_map.get(node.id)
    outs_map[node.id] = {"nodeType": node.type, "data": stored_node_data}
    if isinstance(prev_out, dict):
        for k, v in prev_out.items():
            if k not in ("nodeType", "data"):
                outs_map[node.id][k] = copy.deepcopy(v)


def _resolve_fork_visit(node: Node) -> Any:
    """Return the visit function for a node when it appears in a single-layer fork branch.

    Returns ``None`` if the node is not a valid single-layer fork-parallel target;
    callers should fall back to deferred (non-parallel) execution.
    """
    if node.type == "task" and task_has_process_command(node):
        return _visit_subprocess_task
    if node.type == "llm_agent" and llm_agent_has_executable_command(node):
        return _visit_llm_agent
    if node.type == "agent" and agent_has_executable_config(node):
        return _visit_agent
    if node.type == "http_request" and http_request_has_url(node):
        return _visit_http_request
    if node.type == "rag_query" and rag_query_has_url_and_query(node):
        return _visit_rag_query
    if node.type == "rag_index" and rag_index_has_valid_config(node):
        return _visit_rag_index
    if node.type == "python_code" and python_code_has_code(node):
        return _visit_python_code
    if node.type == "set_variable" and set_variable_has_valid_config(node):
        return _visit_set_variable
    if node.type == "delay" and delay_has_duration(node):
        return _visit_delay
    if node.type == "debounce" and debounce_has_duration(node):
        return _visit_debounce
    if node.type == "wait_for" and wait_for_has_executable_config(node):
        return _visit_wait_for
    return None


def fork_parallel_branch_worker(
    runner: Any,
    plan: ForkBranchPlan,
    ctx: dict[str, Any],
    step_q: StepQueue,
) -> None:
    """Worker body for one branch of a fork-parallel region.

    Wraps the typed visit in an OTel span; on success drives the merge-barrier
    arrival accounting. Any uncaught exception marks the entire run cancelled.
    """
    if ctx.get("_run_cancelled"):
        return
    nid = plan.node_ids[0]
    node = runner._node_by_id.get(nid)
    if node is None:
        return
    try:
        from graph_caster import otel_tracing

        _otel_t = otel_tracing.get_tracer()
        with otel_tracing.node_visit_span(
            _otel_t,
            run_id=str(ctx.get("run_id") or ""),
            graph_id=runner._doc.graph_id,
            node_id=node.id,
            node_type=str(node.type),
        ):
            fork_worker_begin_task_visit(runner, node, ctx)
            visit_fn = _resolve_fork_visit(node)
            if visit_fn is None:
                return
            outcome, used_pin = visit_fn(runner, node, ctx, step_q, fork_parallel_worker=True)
            if ctx.get("_run_cancelled"):
                return
            if outcome == "ok":
                ne: dict[str, Any] = {
                    "nodeId": node.id,
                    "nodeType": node.type,
                    "graphId": runner._doc.graph_id,
                }
                if used_pin:
                    ne["usedPin"] = True
                runner.emit("node_exit", **ne)
                runner._merge_barrier_arrive(plan.merge_id, plan.arrive_source, ctx, step_q)
            else:
                otel_tracing.mark_current_span_error(f"{node.type}_fork_parallel_non_ok")
    except BaseException:
        ctx["_run_cancelled"] = True
