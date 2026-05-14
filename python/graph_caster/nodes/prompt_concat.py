# Copyright GraphCaster. All Rights Reserved.

"""prompt_concat node: render a Mustache-style template by substituting slot expressions."""

from __future__ import annotations

import logging
from typing import Any, Callable

from graph_caster.expression.evaluator import ExpressionEvaluator
from graph_caster.expression.errors import ExpressionError

logger = logging.getLogger(__name__)

EmitFn = Callable[..., None]

_evaluator = ExpressionEvaluator()

_SLOT_PATTERN_STR = r"\$?\{\{\s*(.+?)\s*\}\}"

import re as _re

_SLOT_RE = _re.compile(_SLOT_PATTERN_STR)


def _build_expression_context(ctx: dict[str, Any]) -> dict[str, Any]:
    from graph_caster.runner.expression_conditions import runner_predicate_to_expression_context

    return dict(runner_predicate_to_expression_context(ctx))


def _render_value(expr: str, expr_ctx: dict[str, Any], node_id: str, emit: EmitFn) -> str:
    """Evaluate *expr* and return its string form; returns '' on any error (emits warning)."""
    stripped = expr.strip()
    if not stripped:
        return ""
    try:
        result = _evaluator.evaluate(stripped, expr_ctx)
        if result is None:
            return ""
        if isinstance(result, bool):
            return "true" if result else "false"
        if isinstance(result, (dict, list)):
            import json

            return json.dumps(result, separators=(",", ":"))
        return str(result)
    except ExpressionError as e:
        logger.warning("prompt_concat slot expression failed: %s (expr: %s)", e, stripped)
        emit(
            "node_warning",
            nodeId=node_id,
            kind="slot_expression_failed",
            expression=stripped,
            message=str(e),
        )
        return ""
    except Exception as e:
        logger.error("prompt_concat unexpected error: %s (expr: %s)", e, stripped)
        emit(
            "node_warning",
            nodeId=node_id,
            kind="slot_expression_failed",
            expression=stripped,
            message=str(e),
        )
        return ""


def execute_prompt_concat(
    *,
    node_id: str,
    graph_id: str,
    data: dict[str, Any],
    ctx: dict[str, Any],
    emit: EmitFn,
) -> tuple[bool, dict[str, Any]]:
    """Render a template by substituting named slots with expression values.

    Returns ``(success, patch)`` — patch merges into ``node_outputs[node_id]``:
    ``promptConcatResult`` and ``processResult``.
    """
    template = str(data.get("template") or "")
    slots_raw = data.get("slots")
    slots: dict[str, str] = {}
    if isinstance(slots_raw, dict):
        for k, v in slots_raw.items():
            slots[str(k)] = str(v) if v is not None else ""

    expr_ctx = _build_expression_context(ctx)

    resolved: dict[str, str] = {}
    for slot_name, slot_expr in slots.items():
        inner = slot_expr.strip()
        if _SLOT_RE.fullmatch(inner):
            m = _SLOT_RE.fullmatch(inner)
            assert m is not None
            inner = m.group(1)
        resolved[slot_name] = _render_value(inner, expr_ctx, node_id, emit)

    def _replace_slot(m: _re.Match[str]) -> str:
        name = m.group(1).strip()
        if name in resolved:
            return resolved[name]
        return m.group(0)

    text = _SLOT_RE.sub(_replace_slot, template)

    ctx["last_result"] = text
    emit(
        "process_complete",
        nodeId=node_id,
        graphId=graph_id,
        exitCode=0,
        timedOut=False,
        success=True,
    )

    return True, {
        "processResult": {
            "success": True,
            "exitCode": 0,
            "timedOut": False,
        },
        "promptConcatResult": {
            "success": True,
            "text": text,
        },
    }
