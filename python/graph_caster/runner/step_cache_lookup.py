# Copyright GraphCaster. All Rights Reserved.

"""Shared step-cache key planning (upstream miss / dirty miss / compute key for read or write)."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from graph_caster.node_output_cache import compute_step_cache_key

from graph_caster.runner.run_helpers import cache_key_prefix


@dataclass(frozen=True)
class StepCacheKeyPlan:
    """Result of the common inc_reason / dirty / key branch before ``store.get``."""

    cache_key: str | None
    upstream_incomplete: bool
    try_read_cache: bool


def plan_step_cache_key(
    emit: Callable[..., None],
    *,
    node_id: str,
    graph_id: str,
    graph_rev: str,
    node_data: dict[str, Any],
    upstream_outputs: dict[str, Any],
    inc_reason: str | None,
    graph_ref_upstream_revisions: list[tuple[str, str]],
    dirty: bool,
    tenant_id: str | None,
    workspace_secrets_file_fp: str | None,
    cache_node_kind: str,
) -> StepCacheKeyPlan:
    if inc_reason:
        emit(
            "node_cache_miss",
            nodeId=node_id,
            graphId=graph_id,
            reason=inc_reason,
        )
        return StepCacheKeyPlan(cache_key=None, upstream_incomplete=True, try_read_cache=False)
    if dirty:
        key = compute_step_cache_key(
            graph_rev=graph_rev,
            graph_id=graph_id,
            node_id=node_id,
            node_data=node_data,
            upstream_outputs=upstream_outputs,
            tenant_id=tenant_id,
            workspace_secrets_file_fp=workspace_secrets_file_fp,
            graph_ref_upstream_revisions=graph_ref_upstream_revisions,
            cache_node_kind=cache_node_kind,
        )
        emit(
            "node_cache_miss",
            nodeId=node_id,
            graphId=graph_id,
            keyPrefix=cache_key_prefix(key),
            reason="dirty",
        )
        return StepCacheKeyPlan(cache_key=key, upstream_incomplete=False, try_read_cache=False)
    key = compute_step_cache_key(
        graph_rev=graph_rev,
        graph_id=graph_id,
        node_id=node_id,
        node_data=node_data,
        upstream_outputs=upstream_outputs,
        tenant_id=tenant_id,
        workspace_secrets_file_fp=workspace_secrets_file_fp,
        graph_ref_upstream_revisions=graph_ref_upstream_revisions,
        cache_node_kind=cache_node_kind,
    )
    return StepCacheKeyPlan(cache_key=key, upstream_incomplete=False, try_read_cache=True)
