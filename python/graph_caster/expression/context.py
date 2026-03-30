# Copyright GraphCaster. All Rights Reserved.

"""Runtime context builder for expression evaluation."""

from __future__ import annotations

import copy
from typing import Any, TypedDict


class RunMetadata(TypedDict, total=False):
    id: str
    graph_id: str
    started_at: str
    root_artifact_dir: str


class ExpressionContextDict(TypedDict, total=False):
    json: dict[str, Any]
    nodes: dict[str, dict[str, Any]]
    env: dict[str, str]
    item: dict[str, Any] | None
    run: RunMetadata
    #: Run-level workspace variables (``$vars`` in expressions); sourced from ``ctx["run_variables"]``.
    vars: dict[str, Any]


class ExpressionContext:
    """Builder for expression evaluation context."""

    @classmethod
    def from_run_state(
        cls,
        current_node_id: str,
        node_outputs: dict[str, Any],
        *,
        input_data: dict[str, Any] | None = None,
        env: dict[str, str] | None = None,
        item: dict[str, Any] | None = None,
        run_id: str | None = None,
        graph_id: str | None = None,
        started_at: str | None = None,
        root_artifact_dir: str | None = None,
        run_variables: dict[str, Any] | None = None,
    ) -> ExpressionContextDict:
        _ = current_node_id
        nodes_ctx: dict[str, dict[str, Any]] = {}
        for node_id, output in node_outputs.items():
            nodes_ctx[node_id] = {"json": copy.deepcopy(output) if output else {}}

        run_meta: RunMetadata = {}
        if run_id:
            run_meta["id"] = run_id
        if graph_id:
            run_meta["graph_id"] = graph_id
        if started_at:
            run_meta["started_at"] = started_at
        if root_artifact_dir:
            run_meta["root_artifact_dir"] = root_artifact_dir

        vars_payload: dict[str, Any] = (
            copy.deepcopy(run_variables) if isinstance(run_variables, dict) and run_variables else {}
        )
        out: ExpressionContextDict = {
            "json": copy.deepcopy(input_data) if input_data else {},
            "nodes": nodes_ctx,
            "env": copy.deepcopy(env) if env else {},
            "item": copy.deepcopy(item) if item else None,
            "run": run_meta,
            "vars": vars_payload,
        }
        return out

    @classmethod
    def empty(cls) -> ExpressionContextDict:
        return {
            "json": {},
            "nodes": {},
            "env": {},
            "item": None,
            "run": {},
            "vars": {},
        }
