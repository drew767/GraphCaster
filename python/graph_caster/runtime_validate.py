# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from typing import Any

from graph_caster.cursor_agent_argv import validate_gc_cursor_agent_errors
from graph_caster.errors import ErrorCode
from graph_caster.models import GraphDocument
from graph_caster.process_exec import _argv_from_data


def _gc_cursor_agent_schema_blocker_messages(data: dict[str, Any]) -> list[str]:
    """
    Hard schema issues for ``gcCursorAgent`` that are worth failing before ``run_started``.
    Omits "empty preset" (no prompt / promptFile): the runner still emits ``process_failed`` /
    spawn errors so tests and gradual authoring keep UX parity with pre-MVP behavior.
    """
    errs = validate_gc_cursor_agent_errors(data)
    return [e for e in errs if not e.startswith("gcCursorAgent: set non-empty")]


def first_runtime_node_blocker(doc: GraphDocument) -> tuple[ErrorCode, str, str] | None:
    """
    Return the first node-data issue that should block a root run before ``run_started``,
    or ``None`` if no such blocker was found.

    Intentionally **does not** reject:

    - ``task`` nodes with no ``command``/``argv``/preset (handled at execute time);
    - ``llm_agent`` / ``mcp_tool`` structure issues (``structure_warning`` during run).
    """
    for n in doc.nodes:
        if n.type != "task":
            continue
        data: dict[str, Any] = n.data if isinstance(n.data, dict) else {}
        if _argv_from_data(data) is not None:
            continue
        if "gcCursorAgent" not in data:
            continue
        hard = _gc_cursor_agent_schema_blocker_messages(data)
        if hard:
            return (ErrorCode.GC2002, n.id, "; ".join(hard))
    return None
