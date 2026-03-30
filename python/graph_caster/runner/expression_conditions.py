# Copyright GraphCaster. All Rights Reserved.

"""Edge condition evaluation using the safe inline expression engine."""

from __future__ import annotations

import logging
from typing import Any

from graph_caster.expression import (
    ExpressionContextDict,
    ExpressionError,
    ExpressionEvaluator,
)

logger = logging.getLogger(__name__)

_evaluator = ExpressionEvaluator()


def _last_result_as_json_envelope(last: Any) -> dict[str, Any]:
    if isinstance(last, dict):
        return dict(last)
    return {"value": last}


def runner_predicate_to_expression_context(context: dict[str, Any]) -> ExpressionContextDict:
    """Map runner edge-condition context to ExpressionContextDict."""
    node_outputs = context.get("node_outputs")
    if not isinstance(node_outputs, dict):
        node_outputs = {}
    nodes: dict[str, dict[str, Any]] = {}
    for node_id, output in node_outputs.items():
        if isinstance(output, dict):
            nodes[str(node_id)] = {"json": output}
        else:
            nodes[str(node_id)] = {"json": {"value": output}}
    env = context.get("env")
    if not isinstance(env, dict):
        env = {}
    env_str = {str(k): str(v) for k, v in env.items()}
    rv = context.get("run_variables")
    vars_map: dict[str, Any] = dict(rv) if isinstance(rv, dict) else {}
    return {
        "json": _last_result_as_json_envelope(context.get("last_result")),
        "nodes": nodes,
        "env": env_str,
        "item": None,
        "run": {},
        "vars": vars_map,
    }


def evaluate_edge_condition_inline(
    condition: str | None,
    context: ExpressionContextDict | dict[str, Any],
) -> bool:
    if not condition or not condition.strip():
        return True
    try:
        ctx: dict[str, Any] = dict(context)
        result = _evaluator.evaluate(condition.strip(), ctx)
        return bool(result)
    except ExpressionError as e:
        logger.warning("Edge condition evaluation failed: %s (condition: %s)", e, condition)
        return False
    except Exception as e:
        logger.error("Unexpected error evaluating edge condition: %s (condition: %s)", e, condition)
        return False
