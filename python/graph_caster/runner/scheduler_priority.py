# Copyright GraphCaster. All Rights Reserved.

"""UX-friendly node scheduler (F44).

Picks the highest-priority ready frame from the step queue so the user
sees output-/exit-nodes as early as possible, matching the ComfyUI
``ux_friendly_pick_node`` heuristic.

Priority buckets (lower number = higher priority = picked first):
    1  — output/exit nodes: ``exit``, ``trigger_*`` acting as outputs
    2  — side-effect nodes: ``task`` with responseMode=immediately, ``api_call``, webhooks
    3  — async/IO-bound: ``llm``, ``llm_agent``, ``agent``, ``ai_route``,
                         ``mcp_tool``, ``http_get``, ``http_request``, ``composio_action``, ``openapi_tool``
    4  — compute: ``iteration``, ``loop``, ``for_each``, ``fork``, ``merge``, ``code``, ``python_code``
    5  — pure data / pass-through: ``prompt_concat``, ``reroute``, ``comment``, ``group``,
                                   ``start``, ``set_variable``, anything else
"""

from __future__ import annotations

import logging
import os
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from graph_caster.models import Node
    from graph_caster.step_queue import ExecutionFrame, StepQueue

__all__ = [
    "NODE_PRIORITY",
    "node_priority",
    "pick_next_frame",
    "ux_friendly_enabled",
    "scheduler_trace_enabled",
]

_LOG = logging.getLogger(__name__)

NODE_PRIORITY: dict[str, int] = {
    # Bucket 1 — output / exit
    "exit": 1,
    # trigger_* as outputs are handled dynamically in node_priority()
    # Bucket 2 — side-effect
    "api_call": 2,
    "trigger_webhook": 2,
    # task with responseMode=immediately resolved in node_priority()
    # Bucket 3 — async / IO-bound
    "llm": 3,
    "llm_agent": 3,
    "agent": 3,
    "ai_route": 3,
    "mcp_tool": 3,
    "http_get": 3,
    "http_request": 3,
    "composio_action": 3,
    "openapi_tool": 3,
    # Bucket 4 — compute
    "iteration": 4,
    "loop": 4,
    "for_each": 4,
    "fork": 4,
    "merge": 4,
    "code": 4,
    "python_code": 4,
    # Everything else falls to bucket 5 via the default in node_priority()
}

_PRIORITY_DEFAULT = 5


def node_priority(node: "Node") -> int:
    """Return the scheduling priority bucket for *node* (lower = higher priority)."""
    ntype = str(node.type)

    # Trigger nodes acting as outputs (they fire to external sinks)
    if ntype.startswith("trigger_"):
        return 1

    # task with responseMode=immediately is a side-effect node
    if ntype == "task":
        mode = str(node.data.get("responseMode", "")).strip().lower()
        if mode == "immediately":
            return 2
        return 4  # regular task → compute bucket

    return NODE_PRIORITY.get(ntype, _PRIORITY_DEFAULT)


def pick_next_frame(
    step_q: "StepQueue",
    node_by_id: dict[str, "Node"],
    *,
    emit_trace: "None | (function)" = None,  # type: ignore[syntax]
) -> "ExecutionFrame":
    """Remove and return the highest-priority frame from *step_q*.

    Scans the queue linearly (O(n)), which is fine because real-world queues
    stay tiny — typically 1-4 frames (Dify-style sequential execution).
    Ties within the same bucket preserve FIFO insertion order.
    """
    from graph_caster.step_queue import ExecutionFrame  # avoid circular at module level

    best_idx = 0
    best_pri = _PRIORITY_DEFAULT + 1  # sentinel > any valid bucket

    for idx, frame in enumerate(step_q._q):
        node = node_by_id.get(frame.node_id)
        pri = node_priority(node) if node is not None else _PRIORITY_DEFAULT
        if pri < best_pri:
            best_pri = pri
            best_idx = idx

    # Rotate chosen frame to front, then popleft
    step_q._q.rotate(-best_idx)
    frame = step_q._q.popleft()
    step_q._q.rotate(best_idx)

    if emit_trace is not None:
        node = node_by_id.get(frame.node_id)
        reason = f"priority_bucket_{best_pri}"
        emit_trace(frame.node_id, best_pri, reason)

    return frame


def ux_friendly_enabled() -> bool:
    """Return True when GC_SCHEDULER_UX_FRIENDLY is not explicitly 'off'."""
    raw = os.environ.get("GC_SCHEDULER_UX_FRIENDLY", "on").strip().lower()
    return raw != "off"


def scheduler_trace_enabled() -> bool:
    """Return True when GC_SCHEDULER_TRACE=on."""
    return os.environ.get("GC_SCHEDULER_TRACE", "").strip().lower() == "on"
