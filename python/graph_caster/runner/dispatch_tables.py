# Copyright GraphCaster. All Rights Reserved.

"""Const dispatch tables for the main runner loop.

``REDACT_BY_TYPE`` and ``VISIT_BY_TYPE`` replace the parallel if/elif cascades
that used to live in :func:`GraphRunner._run_from_execution_phase`. They make
adding a new node-type a one-line edit instead of three synchronised edits
across redaction, dispatch, and fork-parallel resolution.

MUST NOT
--------
* Import ``GraphRunner`` (circular).
* Hold mutable module-level state. ``REDACT_BY_TYPE`` / ``VISIT_BY_TYPE`` are
  frozen at import time (Python dicts are mutable in principle; treat them as
  ``Mapping`` at use sites).
* Carry business logic. Every value is either a redact function (pure) or a
  visit thunk that delegates to ``runner.node_visits``.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, Protocol

from graph_caster.delay_wait_exec import redact_timer_node_data_for_execute
from graph_caster.http_request_exec import redact_http_request_data_for_execute
from graph_caster.mcp_client import redact_mcp_tool_data_for_execute
from graph_caster.models import Node
from graph_caster.process_exec import redact_task_data_for_node_execute
from graph_caster.python_code_exec import redact_python_code_data_for_execute
from graph_caster.rag_query_exec import redact_rag_query_data_for_execute
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
from graph_caster.step_queue import StepQueue

VisitOutcome = tuple[Literal["ok", "continue", "break"], bool]
RedactFn = "Any"  # Callable[[dict[str, Any]], dict[str, Any]]


class _VisitFn(Protocol):
    def __call__(
        self,
        runner: Any,
        node: Node,
        ctx: dict[str, Any],
        step_q: StepQueue,
        *,
        fork_parallel_worker: bool,
    ) -> VisitOutcome: ...


def _identity_redact(data: dict[str, Any]) -> dict[str, Any]:
    """No-op redaction. Caller will still clone via ``dict(node.data)`` when storing."""
    return data


REDACT_BY_TYPE: Mapping[str, Any] = {
    "task": redact_task_data_for_node_execute,
    "llm_agent": redact_task_data_for_node_execute,
    "agent": redact_task_data_for_node_execute,
    "mcp_tool": redact_mcp_tool_data_for_execute,
    "http_request": redact_http_request_data_for_execute,
    "rag_query": redact_rag_query_data_for_execute,
    "python_code": redact_python_code_data_for_execute,
    "delay": redact_timer_node_data_for_execute,
    "debounce": redact_timer_node_data_for_execute,
    "wait_for": redact_timer_node_data_for_execute,
}


VISIT_BY_TYPE: Mapping[str, _VisitFn] = {
    "task": run_subprocess_task_visit,
    "llm_agent": run_llm_agent_visit,
    "agent": run_agent_visit,
    "http_request": run_http_request_visit,
    "rag_query": run_rag_query_visit,
    "rag_index": run_rag_index_visit,
    "python_code": run_python_code_visit,
    "set_variable": run_set_variable_visit,
    "delay": run_delay_visit,
    "debounce": run_debounce_visit,
    "wait_for": run_wait_for_visit,
    "trigger_webhook": run_trigger_webhook_visit,
    "trigger_schedule": run_trigger_schedule_visit,
}


def apply_redact(node_type: str, data: dict[str, Any]) -> dict[str, Any]:
    """Return redacted ``data`` for ``node_type``; identity passthrough when unknown."""
    fn = REDACT_BY_TYPE.get(node_type, _identity_redact)
    return fn(data)


def dispatch_visit(
    runner: Any,
    node: Node,
    ctx: dict[str, Any],
    step_q: StepQueue,
) -> VisitOutcome | None:
    """Run the registered visit for ``node.type`` (main-loop, not fork-parallel).

    Returns ``None`` when no visit is registered — control-flow node types
    (``start``, ``exit``, ``fork``, ``merge``, ``ai_route``, ``comment``,
    ``group``, ``graph_ref``, ``mcp_tool``, ``human_input``, ``trigger_error``,
    ``prompt_concat``, ``api_call``) are handled inline by the caller.
    """
    fn = VISIT_BY_TYPE.get(node.type)
    if fn is None:
        return None
    return fn(runner, node, ctx, step_q, fork_parallel_worker=False)
