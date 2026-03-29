# Copyright GraphCaster. All Rights Reserved.

"""Node-kind visit/execute bodies for `GraphRunner` (step cache + process/MCP execution)."""

from __future__ import annotations

import copy
from typing import Any, Literal

from graph_caster.gc_pin import (
    gc_pin_valid_for_short_circuit,
    last_result_from_process_result,
    merged_process_result_for_pin_short_circuit,
    snapshot_for_pin_event,
)
from graph_caster.mcp_client import (
    format_mcp_result_preview,
    redact_mcp_tool_arguments_for_event,
    run_mcp_tool_call,
)
from graph_caster.models import Node
from graph_caster.step_queue import StepQueue

from graph_caster.runner.run_helpers import cache_key_prefix, node_wants_step_cache
from graph_caster.runner.step_cache_lookup import plan_step_cache_key


def run_subprocess_task_visit(
    runner: Any,
    node: Node,
    ctx: dict[str, Any],
    step_q: StepQueue,
    *,
    fork_parallel_worker: bool = False,
) -> tuple[Literal["ok", "continue", "break"], bool]:
    from graph_caster.process_exec import run_task_process

    task_exit_used_pin = False
    outs_map = ctx.setdefault("node_outputs", {})
    sess = ctx.get("_gc_run_session")

    def _should_cancel() -> bool:
        if fork_parallel_worker and ctx.get("_run_cancelled"):
            return True
        return sess is not None and sess.cancel_event.is_set()

    pr_pin = merged_process_result_for_pin_short_circuit(outs_map.get(node.id))
    pin_short = gc_pin_valid_for_short_circuit(node) and pr_pin is not None
    if pin_short:
        task_exit_used_pin = True
        ctx["last_result"] = last_result_from_process_result(pr_pin)
        runner.emit(
            "node_pinned_skip",
            nodeId=node.id,
            graphId=runner._doc.graph_id,
        )
        ok = ctx["last_result"]
    else:
        ok = True

    used_step_cache = False
    cache_key: str | None = None
    pol = runner._step_cache
    store = runner._ensure_step_cache_store()
    want_cache = node_wants_step_cache(node)
    cache_active = (
        not pin_short
        and want_cache
        and pol is not None
        and pol.enabled
        and store is not None
    )
    gid = runner._doc.graph_id
    graph_rev = str(ctx.get("graph_rev") or "")
    tenant_id = ctx.get("tenant_id")
    tenant_s = str(tenant_id).strip() if tenant_id is not None else None
    parent_ref = str(ctx.get("_parent_graph_ref_node_id") or "").strip()
    dirty = bool(
        pol
        and pol.enabled
        and (
            node.id in pol.dirty_nodes
            or (parent_ref != "" and parent_ref in pol.dirty_nodes)
        )
    )
    upstream_incomplete = False
    cache_ws_fp: str | None = (
        runner._step_cache_workspace_secrets_fp(node.data) if cache_active else None
    )

    if not pin_short and cache_active:
        up, inc_reason = runner._upstream_outputs_for_step_cache(node.id, ctx)
        gr_pairs = runner._graph_ref_upstream_revision_pairs(node.id, ctx)
        plan = plan_step_cache_key(
            runner.emit,
            node_id=node.id,
            graph_id=gid,
            graph_rev=graph_rev,
            node_data=node.data,
            upstream_outputs=up,
            inc_reason=inc_reason,
            graph_ref_upstream_revisions=gr_pairs,
            dirty=dirty,
            tenant_id=tenant_s,
            workspace_secrets_file_fp=cache_ws_fp,
            cache_node_kind="task",
        )
        cache_key = plan.cache_key
        upstream_incomplete = plan.upstream_incomplete
        if (
            plan.try_read_cache
            and cache_key is not None
            and store is not None
        ):
            cached = store.get(cache_key)
            if cached is not None:
                outs_map[node.id] = copy.deepcopy(cached)
                pr = cached.get("processResult")
                ctx["last_result"] = last_result_from_process_result(pr)
                runner.emit(
                    "node_cache_hit",
                    nodeId=node.id,
                    graphId=gid,
                    keyPrefix=cache_key_prefix(cache_key),
                )
                used_step_cache = True
            else:
                runner.emit(
                    "node_cache_miss",
                    nodeId=node.id,
                    graphId=gid,
                    keyPrefix=cache_key_prefix(cache_key),
                )

    cancel_fn = _should_cancel if (sess is not None or fork_parallel_worker) else None
    if not pin_short:
        if not used_step_cache:
            ok = run_task_process(
                node_id=node.id,
                graph_id=runner._doc.graph_id,
                data=dict(node.data),
                ctx=ctx,
                emit=runner.emit,
                should_cancel=cancel_fn,
                workspace_secrets=runner._get_workspace_secrets(),
            )
        if (
            ok
            and not used_step_cache
            and cache_active
            and cache_key is not None
            and store is not None
            and not upstream_incomplete
        ):
            store.put(cache_key, copy.deepcopy(outs_map[node.id]))
        snap_o = outs_map.get(node.id)
        if isinstance(snap_o, dict) and isinstance(snap_o.get("processResult"), dict):
            runner.emit(
                "node_outputs_snapshot",
                nodeId=node.id,
                graphId=runner._doc.graph_id,
                snapshot=snapshot_for_pin_event(snap_o),
            )

    if not ok:
        if ctx.get("_gc_process_cancelled"):
            ctx["_run_cancelled"] = True
        ne_task: dict[str, Any] = {
            "nodeId": node.id,
            "nodeType": node.type,
            "graphId": runner._doc.graph_id,
        }
        if task_exit_used_pin:
            ne_task["usedPin"] = True
        runner.emit("node_exit", **ne_task)
        if ctx.get("_gc_process_cancelled"):
            return "break", task_exit_used_pin
        ctx["last_result"] = False
        if runner._follow_edges_from(node.id, ctx, error_route=True, step_q=step_q):
            return "continue", task_exit_used_pin
        return "break", task_exit_used_pin

    return "ok", task_exit_used_pin


def run_llm_agent_visit(
    runner: Any,
    node: Node,
    ctx: dict[str, Any],
    step_q: StepQueue,
    *,
    fork_parallel_worker: bool = False,
) -> tuple[Literal["ok", "continue", "break"], bool]:
    from graph_caster.process_exec import run_llm_agent_process

    # gcPin short-circuit is implemented only for task (see gc_pin.py); keep False here so the
    # visit signature still returns (used_pin) like _run_task_visit; extend when llm_agent supports pin.
    llm_exit_used_pin = False
    outs_map = ctx.setdefault("node_outputs", {})
    sess = ctx.get("_gc_run_session")

    def _should_cancel() -> bool:
        if fork_parallel_worker and ctx.get("_run_cancelled"):
            return True
        return sess is not None and sess.cancel_event.is_set()

    up, inc_reason = runner._upstream_outputs_for_step_cache(node.id, ctx)
    ok = True
    used_step_cache = False
    cache_key: str | None = None
    pol = runner._step_cache
    store = runner._ensure_step_cache_store()
    want_cache = node_wants_step_cache(node)
    cache_active = (
        want_cache
        and pol is not None
        and pol.enabled
        and store is not None
    )
    gid = runner._doc.graph_id
    graph_rev = str(ctx.get("graph_rev") or "")
    tenant_id = ctx.get("tenant_id")
    tenant_s = str(tenant_id).strip() if tenant_id is not None else None
    parent_ref = str(ctx.get("_parent_graph_ref_node_id") or "").strip()
    dirty = bool(
        pol
        and pol.enabled
        and (
            node.id in pol.dirty_nodes
            or (parent_ref != "" and parent_ref in pol.dirty_nodes)
        )
    )
    upstream_incomplete = False
    cache_ws_fp: str | None = (
        runner._step_cache_workspace_secrets_fp(node.data) if cache_active else None
    )

    if cache_active:
        gr_pairs = runner._graph_ref_upstream_revision_pairs(node.id, ctx)
        plan = plan_step_cache_key(
            runner.emit,
            node_id=node.id,
            graph_id=gid,
            graph_rev=graph_rev,
            node_data=node.data,
            upstream_outputs=up,
            inc_reason=inc_reason,
            graph_ref_upstream_revisions=gr_pairs,
            dirty=dirty,
            tenant_id=tenant_s,
            workspace_secrets_file_fp=cache_ws_fp,
            cache_node_kind="llm_agent",
        )
        cache_key = plan.cache_key
        upstream_incomplete = plan.upstream_incomplete
        if plan.try_read_cache and cache_key is not None and store is not None:
            cached = store.get(cache_key)
            if cached is not None:
                outs_map[node.id] = copy.deepcopy(cached)
                pr = cached.get("processResult")
                ctx["last_result"] = last_result_from_process_result(pr)
                runner.emit(
                    "node_cache_hit",
                    nodeId=node.id,
                    graphId=gid,
                    keyPrefix=cache_key_prefix(cache_key),
                )
                used_step_cache = True
            else:
                runner.emit(
                    "node_cache_miss",
                    nodeId=node.id,
                    graphId=gid,
                    keyPrefix=cache_key_prefix(cache_key),
                )

    cancel_fn = _should_cancel if (sess is not None or fork_parallel_worker) else None
    if not used_step_cache:
        ok = run_llm_agent_process(
            node_id=node.id,
            graph_id=runner._doc.graph_id,
            data=dict(node.data),
            ctx=ctx,
            upstream_outputs=up,
            emit=runner.emit,
            should_cancel=cancel_fn,
            workspace_secrets=runner._get_workspace_secrets(),
        )
    if (
        ok
        and not used_step_cache
        and cache_active
        and cache_key is not None
        and store is not None
        and not upstream_incomplete
    ):
        store.put(cache_key, copy.deepcopy(outs_map[node.id]))
    snap_o = outs_map.get(node.id)
    if isinstance(snap_o, dict) and isinstance(snap_o.get("processResult"), dict):
        runner.emit(
            "node_outputs_snapshot",
            nodeId=node.id,
            graphId=runner._doc.graph_id,
            snapshot=snapshot_for_pin_event(snap_o),
        )

    if not ok:
        if ctx.get("_gc_process_cancelled"):
            ctx["_run_cancelled"] = True
        ne_task: dict[str, Any] = {
            "nodeId": node.id,
            "nodeType": node.type,
            "graphId": runner._doc.graph_id,
        }
        if llm_exit_used_pin:
            ne_task["usedPin"] = True
        runner.emit("node_exit", **ne_task)
        if ctx.get("_gc_process_cancelled"):
            return "break", llm_exit_used_pin
        ctx["last_result"] = False
        if runner._follow_edges_from(node.id, ctx, error_route=True, step_q=step_q):
            return "continue", llm_exit_used_pin
        return "break", llm_exit_used_pin

    return "ok", llm_exit_used_pin


def execute_mcp_tool_node(runner: Any, node: Node, ctx: dict[str, Any]) -> bool:
    sess = ctx.get("_gc_run_session")
    if sess is not None and sess.cancel_event.is_set():
        ctx["_run_cancelled"] = True
        return False

    d = dict(node.data)
    tool_name = str(d.get("toolName") or "").strip()
    raw_args = d.get("arguments")
    arguments: dict[str, Any] = raw_args if isinstance(raw_args, dict) else {}

    to = float(d.get("timeoutSec") if d.get("timeoutSec") is not None else 60.0)
    if to < 1.0:
        to = 1.0
    if to > 600.0:
        to = 600.0

    transport = str(d.get("transport") or "stdio").strip()
    outs_map = ctx.setdefault("node_outputs", {})
    gid = runner._doc.graph_id

    if not tool_name:
        runner.emit(
            "mcp_tool_failed",
            nodeId=node.id,
            graphId=gid,
            toolName=tool_name,
            transport=transport,
            errorMessage="empty_tool_name",
            errorCode="config",
        )
        outs_map[node.id]["mcpTool"] = {
            "success": False,
            "error": "empty_tool_name",
            "code": "config",
        }
        ctx["last_result"] = False
        return False

    graph_rev = str(ctx.get("graph_rev") or "")
    tenant_id = ctx.get("tenant_id")
    tenant_s = str(tenant_id).strip() if tenant_id is not None else None
    parent_ref = str(ctx.get("_parent_graph_ref_node_id") or "").strip()
    pol = runner._step_cache
    store = runner._ensure_step_cache_store()
    want_cache = node_wants_step_cache(node)
    prov = ctx.get("mcp_tool_provider")
    provider_override = prov if callable(prov) else None
    dirty = bool(
        pol
        and pol.enabled
        and (
            node.id in pol.dirty_nodes
            or (parent_ref != "" and parent_ref in pol.dirty_nodes)
        )
    )
    cache_active = (
        provider_override is None
        and want_cache
        and pol is not None
        and pol.enabled
        and store is not None
    )
    used_step_cache = False
    cache_key: str | None = None
    upstream_incomplete = False
    cache_ws_fp: str | None = (
        runner._step_cache_workspace_secrets_fp(node.data) if cache_active else None
    )

    if cache_active:
        up, inc_reason = runner._upstream_outputs_for_step_cache(node.id, ctx)
        gr_pairs = runner._graph_ref_upstream_revision_pairs(node.id, ctx)
        plan = plan_step_cache_key(
            runner.emit,
            node_id=node.id,
            graph_id=gid,
            graph_rev=graph_rev,
            node_data=node.data,
            upstream_outputs=up,
            inc_reason=inc_reason,
            graph_ref_upstream_revisions=gr_pairs,
            dirty=dirty,
            tenant_id=tenant_s,
            workspace_secrets_file_fp=cache_ws_fp,
            cache_node_kind="mcp_tool",
        )
        cache_key = plan.cache_key
        upstream_incomplete = plan.upstream_incomplete
        if plan.try_read_cache and cache_key is not None and store is not None:
            cached = store.get(cache_key)
            if cached is not None:
                outs_map[node.id] = copy.deepcopy(cached)
                mt = cached.get("mcpTool")
                ctx["last_result"] = bool(isinstance(mt, dict) and mt.get("success"))
                runner.emit(
                    "node_cache_hit",
                    nodeId=node.id,
                    graphId=gid,
                    keyPrefix=cache_key_prefix(cache_key),
                )
                runner.emit(
                    "mcp_tool_result",
                    nodeId=node.id,
                    graphId=gid,
                    toolName=tool_name,
                    transport=transport,
                    resultPreview=format_mcp_result_preview(
                        mt.get("result") if isinstance(mt, dict) else None
                    ),
                    fromStepCache=True,
                )
                used_step_cache = True
            else:
                runner.emit(
                    "node_cache_miss",
                    nodeId=node.id,
                    graphId=gid,
                    keyPrefix=cache_key_prefix(cache_key),
                )

    if used_step_cache:
        return bool(ctx["last_result"])

    inv_args = redact_mcp_tool_arguments_for_event(arguments)
    runner.emit(
        "mcp_tool_invoke",
        nodeId=node.id,
        graphId=gid,
        toolName=tool_name,
        transport=transport,
        arguments=inv_args,
    )

    override = provider_override
    outcome = run_mcp_tool_call(
        data=d,
        ctx=ctx,
        graph_id=gid,
        node_id=node.id,
        workspace_secrets=runner._get_workspace_secrets(),
        tool_name=tool_name,
        arguments=arguments,
        timeout_sec=to,
        provider=override,
    )

    if outcome.ok:
        runner.emit(
            "mcp_tool_result",
            nodeId=node.id,
            graphId=gid,
            toolName=tool_name,
            transport=transport,
            resultPreview=format_mcp_result_preview(outcome.result),
        )
        outs_map[node.id]["mcpTool"] = {"success": True, "result": outcome.result}
        ctx["last_result"] = True
        if (
            cache_active
            and cache_key is not None
            and store is not None
            and not upstream_incomplete
        ):
            store.put(cache_key, copy.deepcopy(outs_map[node.id]))
        return True

    runner.emit(
        "mcp_tool_failed",
        nodeId=node.id,
        graphId=gid,
        toolName=tool_name,
        transport=transport,
        errorMessage=outcome.error or "error",
        errorCode=outcome.code,
    )
    outs_map[node.id]["mcpTool"] = {
        "success": False,
        "error": outcome.error,
        "code": outcome.code,
        "result": outcome.result,
    }
    ctx["last_result"] = False
    return False
