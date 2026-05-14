# Copyright GraphCaster. All Rights Reserved.

"""Helpers to inject VariableContext scopes into the expression evaluator context."""

from __future__ import annotations

from typing import Any

from .lifecycle import VariableContext


def merge_variable_context_into_expr_ctx(
    expr_ctx: dict[str, Any],
    var_ctx: VariableContext,
) -> dict[str, Any]:
    """Merge scoped variable dicts into *expr_ctx* and return it (mutated in-place).

    The merged keys are: ``sys``, ``run`` (overrides existing ``run``),
    ``session``, ``tenant``, ``env`` (overrides existing ``env``).

    ``$json``, ``$node``, ``last_result``, ``node_outputs``, ``vars`` are
    untouched so existing behaviour is preserved.
    """
    scopes = var_ctx.to_expression_dict_sync()
    expr_ctx["sys"] = scopes.get("sys", {})
    # "run" in the expression context is RunMetadata (run_id, graph_id…).
    # We extend it with VariableScope.RUN entries without overwriting runner metadata.
    run_meta = dict(expr_ctx.get("run") or {})
    run_meta.update(scopes.get("run", {}))
    expr_ctx["run"] = run_meta
    expr_ctx["session"] = scopes.get("session", {})
    expr_ctx["tenant"] = scopes.get("tenant", {})
    # env is merged: var_ctx env takes precedence over the runner's env dict
    existing_env = dict(expr_ctx.get("env") or {})
    existing_env.update(scopes.get("env", {}))
    expr_ctx["env"] = existing_env
    return expr_ctx
