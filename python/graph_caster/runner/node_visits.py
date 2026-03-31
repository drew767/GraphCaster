# Copyright GraphCaster. All Rights Reserved.

"""Node-kind visit/execute bodies for `GraphRunner` (step cache + process/MCP execution)."""

from __future__ import annotations

import copy
import time
from typing import Any, Literal

from graph_caster.runner.retry_policy import (
    circuit_is_open,
    circuit_on_failure,
    circuit_on_success,
    compute_retry_sleep_sec,
    parse_retry_policy,
)

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
from graph_caster.http_request_exec import execute_http_request
from graph_caster.python_code_exec import execute_python_code
from graph_caster.rag_index_exec import execute_rag_index
from graph_caster.rag_query_exec import execute_rag_query
from graph_caster.delay_wait_exec import (
    execute_delay_or_debounce,
    execute_wait_for_file,
)
from graph_caster.set_variable_exec import execute_set_variable
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
            policy = parse_retry_policy(dict(node.data))
            if policy is None:
                ok = run_task_process(
                    node_id=node.id,
                    graph_id=runner._doc.graph_id,
                    data=dict(node.data),
                    ctx=ctx,
                    emit=runner.emit,
                    should_cancel=cancel_fn,
                    workspace_secrets=runner._get_workspace_secrets(),
                )
            elif circuit_is_open(ctx, node.id, policy):
                ok = False
            else:
                ok = False
                for attempt in range(policy.max_attempts):
                    if cancel_fn is not None and cancel_fn():
                        ctx["_gc_process_cancelled"] = True
                        ok = False
                        break
                    ok = run_task_process(
                        node_id=node.id,
                        graph_id=runner._doc.graph_id,
                        data=dict(node.data),
                        ctx=ctx,
                        emit=runner.emit,
                        should_cancel=cancel_fn,
                        workspace_secrets=runner._get_workspace_secrets(),
                    )
                    if ok:
                        circuit_on_success(ctx, node.id, policy)
                        break
                    circuit_on_failure(ctx, node.id, policy)
                    if attempt + 1 >= policy.max_attempts:
                        break
                    sleep_sec = compute_retry_sleep_sec(policy, attempt)
                    if sleep_sec > 0:
                        runner.emit(
                            "process_retry",
                            nodeId=node.id,
                            graphId=gid,
                            attempt=attempt + 1,
                            delaySec=sleep_sec,
                            reason="runner_retry_policy",
                        )
                        deadline = time.monotonic() + sleep_sec
                        while time.monotonic() < deadline:
                            if cancel_fn is not None and cancel_fn():
                                ctx["_gc_process_cancelled"] = True
                                ok = False
                                break
                            time.sleep(max(0.0, min(0.2, deadline - time.monotonic())))
                        if cancel_fn is not None and cancel_fn():
                            break
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


def run_agent_visit(
    runner: Any,
    node: Node,
    ctx: dict[str, Any],
    step_q: StepQueue,
    *,
    fork_parallel_worker: bool = False,
) -> tuple[Literal["ok", "continue", "break"], bool]:
    """In-runner ``agent`` node (tool loop; no subprocess)."""
    from graph_caster.agent.in_runner_exec import execute_in_runner_agent

    agent_used_pin = False
    outs_map = ctx.setdefault("node_outputs", {})
    sess = ctx.get("_gc_run_session")

    def _should_cancel() -> bool:
        if fork_parallel_worker and ctx.get("_run_cancelled"):
            return True
        return sess is not None and sess.cancel_event.is_set()

    if _should_cancel():
        ctx["_run_cancelled"] = True
        return "break", agent_used_pin

    ok, patch = execute_in_runner_agent(
        node=node,
        graph_id=runner._doc.graph_id,
        ctx=ctx,
        emit=runner.emit,
    )
    for k, v in patch.items():
        outs_map[node.id][k] = copy.deepcopy(v)

    ar = patch.get("agentResult") if isinstance(patch, dict) else None
    if isinstance(ar, dict) and ar.get("success") is True:
        txt = ar.get("text")
        ctx["last_result"] = txt if txt not in (None, "") else True
    else:
        ctx["last_result"] = False

    if not ok:
        ne_task: dict[str, Any] = {
            "nodeId": node.id,
            "nodeType": node.type,
            "graphId": runner._doc.graph_id,
        }
        runner.emit("node_exit", **ne_task)
        ctx["last_result"] = False
        if runner._follow_edges_from(node.id, ctx, error_route=True, step_q=step_q):
            return "continue", agent_used_pin
        return "break", agent_used_pin

    return "ok", agent_used_pin


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


def run_http_request_visit(
    runner: Any,
    node: Node,
    ctx: dict[str, Any],
    step_q: StepQueue,
    *,
    fork_parallel_worker: bool = False,
) -> tuple[Literal["ok", "continue", "break"], bool]:
    """HTTP request node with step cache and optional retry policy (``data.retry`` / ``data.retryPolicy``)."""
    http_used_pin = False
    outs_map = ctx.setdefault("node_outputs", {})
    sess = ctx.get("_gc_run_session")
    gid = runner._doc.graph_id

    def _should_cancel() -> bool:
        if fork_parallel_worker and ctx.get("_run_cancelled"):
            return True
        return sess is not None and sess.cancel_event.is_set()

    graph_rev = str(ctx.get("graph_rev") or "")
    tenant_id = ctx.get("tenant_id")
    tenant_s = str(tenant_id).strip() if tenant_id is not None else None
    parent_ref = str(ctx.get("_parent_graph_ref_node_id") or "").strip()
    pol = runner._step_cache
    store = runner._ensure_step_cache_store()
    want_cache = node_wants_step_cache(node)
    cache_active = want_cache and pol is not None and pol.enabled and store is not None
    dirty = bool(
        pol
        and pol.enabled
        and (
            node.id in pol.dirty_nodes
            or (parent_ref != "" and parent_ref in pol.dirty_nodes)
        )
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
            cache_node_kind="http_request",
        )
        cache_key = plan.cache_key
        upstream_incomplete = plan.upstream_incomplete
        if plan.try_read_cache and cache_key is not None and store is not None:
            cached = store.get(cache_key)
            if cached is not None:
                outs_map[node.id] = copy.deepcopy(cached)
                hr = cached.get("httpResult")
                if isinstance(hr, dict):
                    lr: dict[str, Any] = {
                        "statusCode": int(hr.get("statusCode") or 0),
                        "ok": bool(hr.get("success")),
                    }
                    j = hr.get("bodyJson")
                    if j is not None:
                        lr["json"] = j
                    elif isinstance(hr.get("bodyText"), str) and hr.get("bodyText"):
                        lr["body"] = hr["bodyText"]
                    ctx["last_result"] = lr
                else:
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
    ok = True
    if not used_step_cache:
        data = dict(node.data)
        policy = parse_retry_policy(data)
        patch: dict[str, Any]
        if policy is None:
            ok, patch = execute_http_request(
                node_id=node.id,
                graph_id=gid,
                data=data,
                ctx=ctx,
                emit=runner.emit,
                attempt=0,
                should_cancel=cancel_fn,
            )
        elif circuit_is_open(ctx, node.id, policy):
            ok = False
            patch = {
                "processResult": {
                    "success": False,
                    "exitCode": 0,
                    "timedOut": False,
                    "error": "circuit_open",
                },
                "httpResult": {
                    "success": False,
                    "statusCode": 0,
                    "error": "circuit_open",
                    "bodyText": "",
                    "bodyJson": None,
                    "headers": {},
                },
            }
            ctx["last_result"] = False
        else:
            ok = False
            patch = {}
            for attempt in range(policy.max_attempts):
                if cancel_fn is not None and cancel_fn():
                    ctx["_gc_process_cancelled"] = True
                    ok = False
                    patch = {
                        "processResult": {
                            "success": False,
                            "exitCode": 0,
                            "timedOut": False,
                            "cancelled": True,
                            "error": "cancelled",
                        },
                        "httpResult": {
                            "success": False,
                            "statusCode": 0,
                            "error": "cancelled",
                            "bodyText": "",
                            "bodyJson": None,
                            "headers": {},
                        },
                    }
                    break
                ok, patch = execute_http_request(
                    node_id=node.id,
                    graph_id=gid,
                    data=data,
                    ctx=ctx,
                    emit=runner.emit,
                    attempt=attempt,
                    should_cancel=cancel_fn,
                )
                if ok:
                    circuit_on_success(ctx, node.id, policy)
                    break
                circuit_on_failure(ctx, node.id, policy)
                if attempt + 1 >= policy.max_attempts:
                    break
                sleep_sec = compute_retry_sleep_sec(policy, attempt)
                if sleep_sec > 0:
                    runner.emit(
                        "process_retry",
                        nodeId=node.id,
                        graphId=gid,
                        attempt=attempt + 1,
                        delaySec=sleep_sec,
                        reason="runner_retry_policy",
                    )
                    deadline = time.monotonic() + sleep_sec
                    while time.monotonic() < deadline:
                        if cancel_fn is not None and cancel_fn():
                            ctx["_gc_process_cancelled"] = True
                            ok = False
                            break
                        time.sleep(max(0.0, min(0.2, deadline - time.monotonic())))
                    if cancel_fn is not None and cancel_fn():
                        break

        for k, v in patch.items():
            outs_map[node.id][k] = v

        if (
            ok
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
        runner.emit("node_exit", **ne_task)
        if ctx.get("_gc_process_cancelled"):
            return "break", http_used_pin
        ctx["last_result"] = False
        if runner._follow_edges_from(node.id, ctx, error_route=True, step_q=step_q):
            return "continue", http_used_pin
        return "break", http_used_pin

    return "ok", http_used_pin


def run_rag_query_visit(
    runner: Any,
    node: Node,
    ctx: dict[str, Any],
    step_q: StepQueue,
    *,
    fork_parallel_worker: bool = False,
) -> tuple[Literal["ok", "continue", "break"], bool]:
    """``rag_query`` node: HTTP delegate with step cache and optional retry policy."""
    rag_used_pin = False
    outs_map = ctx.setdefault("node_outputs", {})
    sess = ctx.get("_gc_run_session")
    gid = runner._doc.graph_id

    def _should_cancel() -> bool:
        if fork_parallel_worker and ctx.get("_run_cancelled"):
            return True
        return sess is not None and sess.cancel_event.is_set()

    graph_rev = str(ctx.get("graph_rev") or "")
    tenant_id = ctx.get("tenant_id")
    tenant_s = str(tenant_id).strip() if tenant_id is not None else None
    parent_ref = str(ctx.get("_parent_graph_ref_node_id") or "").strip()
    pol = runner._step_cache
    store = runner._ensure_step_cache_store()
    want_cache = node_wants_step_cache(node)
    cache_active = want_cache and pol is not None and pol.enabled and store is not None
    dirty = bool(
        pol
        and pol.enabled
        and (
            node.id in pol.dirty_nodes
            or (parent_ref != "" and parent_ref in pol.dirty_nodes)
        )
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
            cache_node_kind="rag_query",
        )
        cache_key = plan.cache_key
        upstream_incomplete = plan.upstream_incomplete
        if plan.try_read_cache and cache_key is not None and store is not None:
            cached = store.get(cache_key)
            if cached is not None:
                outs_map[node.id] = copy.deepcopy(cached)
                hr = cached.get("httpResult")
                if isinstance(hr, dict):
                    lr: dict[str, Any] = {
                        "statusCode": int(hr.get("statusCode") or 0),
                        "ok": bool(hr.get("success")),
                    }
                    j = hr.get("bodyJson")
                    if j is not None:
                        lr["json"] = j
                    elif isinstance(hr.get("bodyText"), str) and hr.get("bodyText"):
                        lr["body"] = hr["bodyText"]
                    ctx["last_result"] = lr
                else:
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
    ok = True
    if not used_step_cache:
        data = dict(node.data)
        policy = parse_retry_policy(data)
        patch: dict[str, Any]
        if policy is None:
            ok, patch = execute_rag_query(
                node_id=node.id,
                graph_id=gid,
                data=data,
                ctx=ctx,
                emit=runner.emit,
                attempt=0,
                should_cancel=cancel_fn,
            )
        elif circuit_is_open(ctx, node.id, policy):
            ok = False
            patch = {
                "processResult": {
                    "success": False,
                    "exitCode": 0,
                    "timedOut": False,
                    "error": "circuit_open",
                },
                "httpResult": {
                    "success": False,
                    "statusCode": 0,
                    "error": "circuit_open",
                    "bodyText": "",
                    "bodyJson": None,
                    "headers": {},
                },
                "ragResult": {"success": False, "error": "circuit_open"},
            }
            ctx["last_result"] = False
        else:
            ok = False
            patch = {}
            for attempt in range(policy.max_attempts):
                if cancel_fn is not None and cancel_fn():
                    ctx["_gc_process_cancelled"] = True
                    ok = False
                    patch = {
                        "processResult": {
                            "success": False,
                            "exitCode": 0,
                            "timedOut": False,
                            "cancelled": True,
                            "error": "cancelled",
                        },
                        "httpResult": {
                            "success": False,
                            "statusCode": 0,
                            "error": "cancelled",
                            "bodyText": "",
                            "bodyJson": None,
                            "headers": {},
                        },
                        "ragResult": {"success": False, "error": "cancelled"},
                    }
                    break
                ok, patch = execute_rag_query(
                    node_id=node.id,
                    graph_id=gid,
                    data=data,
                    ctx=ctx,
                    emit=runner.emit,
                    attempt=attempt,
                    should_cancel=cancel_fn,
                )
                if ok:
                    circuit_on_success(ctx, node.id, policy)
                    break
                circuit_on_failure(ctx, node.id, policy)
                if attempt + 1 >= policy.max_attempts:
                    break
                sleep_sec = compute_retry_sleep_sec(policy, attempt)
                if sleep_sec > 0:
                    runner.emit(
                        "process_retry",
                        nodeId=node.id,
                        graphId=gid,
                        attempt=attempt + 1,
                        delaySec=sleep_sec,
                        reason="runner_retry_policy",
                    )
                    deadline = time.monotonic() + sleep_sec
                    while time.monotonic() < deadline:
                        if cancel_fn is not None and cancel_fn():
                            ctx["_gc_process_cancelled"] = True
                            ok = False
                            break
                        time.sleep(max(0.0, min(0.2, deadline - time.monotonic())))
                    if cancel_fn is not None and cancel_fn():
                        break

        for k, v in patch.items():
            outs_map[node.id][k] = v

        if (
            ok
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
        runner.emit("node_exit", **ne_task)
        if ctx.get("_gc_process_cancelled"):
            return "break", rag_used_pin
        ctx["last_result"] = False
        if runner._follow_edges_from(node.id, ctx, error_route=True, step_q=step_q):
            return "continue", rag_used_pin
        return "break", rag_used_pin

    return "ok", rag_used_pin


def run_python_code_visit(
    runner: Any,
    node: Node,
    ctx: dict[str, Any],
    step_q: StepQueue,
    *,
    fork_parallel_worker: bool = False,
) -> tuple[Literal["ok", "continue", "break"], bool]:
    """python_code node: subprocess worker, step cache, optional retry policy."""
    py_used_pin = False
    outs_map = ctx.setdefault("node_outputs", {})
    sess = ctx.get("_gc_run_session")
    gid = runner._doc.graph_id

    def _should_cancel() -> bool:
        if fork_parallel_worker and ctx.get("_run_cancelled"):
            return True
        return sess is not None and sess.cancel_event.is_set()

    graph_rev = str(ctx.get("graph_rev") or "")
    tenant_id = ctx.get("tenant_id")
    tenant_s = str(tenant_id).strip() if tenant_id is not None else None
    parent_ref = str(ctx.get("_parent_graph_ref_node_id") or "").strip()
    pol = runner._step_cache
    store = runner._ensure_step_cache_store()
    want_cache = node_wants_step_cache(node)
    cache_active = want_cache and pol is not None and pol.enabled and store is not None
    dirty = bool(
        pol
        and pol.enabled
        and (
            node.id in pol.dirty_nodes
            or (parent_ref != "" and parent_ref in pol.dirty_nodes)
        )
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
            cache_node_kind="python_code",
        )
        cache_key = plan.cache_key
        upstream_incomplete = plan.upstream_incomplete
        if plan.try_read_cache and cache_key is not None and store is not None:
            cached = store.get(cache_key)
            if cached is not None:
                outs_map[node.id] = copy.deepcopy(cached)
                cr = cached.get("codeResult")
                if isinstance(cr, dict) and cr.get("success") is True:
                    ctx["last_result"] = cr.get("result")
                else:
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
    ok = True
    if not used_step_cache:
        data = dict(node.data)
        policy = parse_retry_policy(data)
        patch: dict[str, Any]
        if policy is None:
            ok, patch = execute_python_code(
                node_id=node.id,
                graph_id=gid,
                data=data,
                ctx=ctx,
                emit=runner.emit,
                attempt=0,
                should_cancel=cancel_fn,
            )
        elif circuit_is_open(ctx, node.id, policy):
            ok = False
            patch = {
                "processResult": {
                    "success": False,
                    "exitCode": 0,
                    "timedOut": False,
                    "error": "circuit_open",
                },
                "codeResult": {
                    "success": False,
                    "error": "circuit_open",
                    "result": None,
                },
            }
            ctx["last_result"] = False
        else:
            ok = False
            patch = {}
            for attempt in range(policy.max_attempts):
                if cancel_fn is not None and cancel_fn():
                    ctx["_gc_process_cancelled"] = True
                    ok = False
                    patch = {
                        "processResult": {
                            "success": False,
                            "exitCode": 0,
                            "timedOut": False,
                            "cancelled": True,
                            "error": "cancelled",
                        },
                        "codeResult": {
                            "success": False,
                            "error": "cancelled",
                            "result": None,
                        },
                    }
                    break
                ok, patch = execute_python_code(
                    node_id=node.id,
                    graph_id=gid,
                    data=data,
                    ctx=ctx,
                    emit=runner.emit,
                    attempt=attempt,
                    should_cancel=cancel_fn,
                )
                if ok:
                    circuit_on_success(ctx, node.id, policy)
                    break
                circuit_on_failure(ctx, node.id, policy)
                if attempt + 1 >= policy.max_attempts:
                    break
                sleep_sec = compute_retry_sleep_sec(policy, attempt)
                if sleep_sec > 0:
                    runner.emit(
                        "process_retry",
                        nodeId=node.id,
                        graphId=gid,
                        attempt=attempt + 1,
                        delaySec=sleep_sec,
                        reason="runner_retry_policy",
                    )
                    deadline = time.monotonic() + sleep_sec
                    while time.monotonic() < deadline:
                        if cancel_fn is not None and cancel_fn():
                            ctx["_gc_process_cancelled"] = True
                            ok = False
                            break
                        time.sleep(max(0.0, min(0.2, deadline - time.monotonic())))
                    if cancel_fn is not None and cancel_fn():
                        break

        for k, v in patch.items():
            outs_map[node.id][k] = v

        if (
            ok
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
        runner.emit("node_exit", **ne_task)
        if ctx.get("_gc_process_cancelled"):
            return "break", py_used_pin
        ctx["last_result"] = False
        if runner._follow_edges_from(node.id, ctx, error_route=True, step_q=step_q):
            return "continue", py_used_pin
        return "break", py_used_pin

    return "ok", py_used_pin


def _apply_timer_patch_to_outputs(
    runner: Any,
    node: Node,
    ctx: dict[str, Any],
    step_q: StepQueue,
    *,
    ok: bool,
    patch: dict[str, Any],
    used_pin: bool = False,
) -> tuple[Literal["ok", "continue", "break"], bool]:
    outs_map = ctx.setdefault("node_outputs", {})
    for k, v in patch.items():
        outs_map[node.id][k] = v

    snap_o = outs_map.get(node.id)
    if isinstance(snap_o, dict) and isinstance(snap_o.get("processResult"), dict):
        runner.emit(
            "node_outputs_snapshot",
            nodeId=node.id,
            graphId=runner._doc.graph_id,
            snapshot=snapshot_for_pin_event(snap_o),
        )

    if ok:
        wr = patch.get("waitResult")
        if isinstance(wr, dict) and wr.get("success") is True:
            ctx["last_result"] = {"wait": wr}
        else:
            ctx["last_result"] = True
        return "ok", used_pin

    if ctx.get("_gc_process_cancelled"):
        ctx["_run_cancelled"] = True
    ne_task: dict[str, Any] = {
        "nodeId": node.id,
        "nodeType": node.type,
        "graphId": runner._doc.graph_id,
    }
    runner.emit("node_exit", **ne_task)
    if ctx.get("_gc_process_cancelled"):
        return "break", used_pin
    ctx["last_result"] = False
    if runner._follow_edges_from(node.id, ctx, error_route=True, step_q=step_q):
        return "continue", used_pin
    return "break", used_pin


def run_rag_index_visit(
    runner: Any,
    node: Node,
    ctx: dict[str, Any],
    step_q: StepQueue,
    *,
    fork_parallel_worker: bool = False,
) -> tuple[Literal["ok", "continue", "break"], bool]:
    """Index text chunks into the in-memory vector store for this graph run."""
    _ = fork_parallel_worker
    outs_map = ctx.setdefault("node_outputs", {})
    ok, patch = execute_rag_index(
        node_id=node.id,
        graph_id=runner._doc.graph_id,
        data=dict(node.data),
        ctx=ctx,
    )
    for k, v in patch.items():
        outs_map[node.id][k] = v

    snap_o = outs_map.get(node.id)
    if isinstance(snap_o, dict) and isinstance(snap_o.get("processResult"), dict):
        runner.emit(
            "node_outputs_snapshot",
            nodeId=node.id,
            graphId=runner._doc.graph_id,
            snapshot=snapshot_for_pin_event(snap_o),
        )

    if ok:
        ctx["last_result"] = True
        return "ok", False

    ne_task: dict[str, Any] = {
        "nodeId": node.id,
        "nodeType": node.type,
        "graphId": runner._doc.graph_id,
    }
    runner.emit("node_exit", **ne_task)
    ctx["last_result"] = False
    if runner._follow_edges_from(node.id, ctx, error_route=True, step_q=step_q):
        return "continue", False
    return "break", False


def run_set_variable_visit(
    runner: Any,
    node: Node,
    ctx: dict[str, Any],
    step_q: StepQueue,
    *,
    fork_parallel_worker: bool = False,
) -> tuple[Literal["ok", "continue", "break"], bool]:
    """Update run variables from node data (synchronous)."""
    _ = fork_parallel_worker
    outs_map = ctx.setdefault("node_outputs", {})
    ok, patch = execute_set_variable(
        node_id=node.id,
        graph_id=runner._doc.graph_id,
        data=dict(node.data),
        ctx=ctx,
    )
    for k, v in patch.items():
        outs_map[node.id][k] = v

    snap_o = outs_map.get(node.id)
    if isinstance(snap_o, dict) and isinstance(snap_o.get("processResult"), dict):
        runner.emit(
            "node_outputs_snapshot",
            nodeId=node.id,
            graphId=runner._doc.graph_id,
            snapshot=snapshot_for_pin_event(snap_o),
        )

    if ok:
        svr = patch.get("setVariableResult")
        if isinstance(svr, dict) and svr.get("success") is True and "value" in svr:
            ctx["last_result"] = svr.get("value")
        else:
            ctx["last_result"] = True
        return "ok", False

    ne_task: dict[str, Any] = {
        "nodeId": node.id,
        "nodeType": node.type,
        "graphId": runner._doc.graph_id,
    }
    runner.emit("node_exit", **ne_task)
    ctx["last_result"] = False
    if runner._follow_edges_from(node.id, ctx, error_route=True, step_q=step_q):
        return "continue", False
    return "break", False


def run_delay_visit(
    runner: Any,
    node: Node,
    ctx: dict[str, Any],
    step_q: StepQueue,
    *,
    fork_parallel_worker: bool = False,
) -> tuple[Literal["ok", "continue", "break"], bool]:
    """Fixed-duration sleep (`delay` node)."""
    sess = ctx.get("_gc_run_session")

    def _should_cancel() -> bool:
        if fork_parallel_worker and ctx.get("_run_cancelled"):
            return True
        return sess is not None and sess.cancel_event.is_set()

    cancel_fn = _should_cancel if (sess is not None or fork_parallel_worker) else None
    ok, patch = execute_delay_or_debounce(
        node_id=node.id,
        graph_id=runner._doc.graph_id,
        wait_kind="delay",
        data=dict(node.data),
        emit=runner.emit,
        should_cancel=cancel_fn,
    )
    if not ok and patch.get("processResult", {}).get("cancelled") is True:
        ctx["_gc_process_cancelled"] = True
    return _apply_timer_patch_to_outputs(runner, node, ctx, step_q, ok=ok, patch=patch)


def run_debounce_visit(
    runner: Any,
    node: Node,
    ctx: dict[str, Any],
    step_q: StepQueue,
    *,
    fork_parallel_worker: bool = False,
) -> tuple[Literal["ok", "continue", "break"], bool]:
    """Quiet-period wait (`debounce` node; same sleep semantics as `delay`, separate kind for events)."""
    sess = ctx.get("_gc_run_session")

    def _should_cancel() -> bool:
        if fork_parallel_worker and ctx.get("_run_cancelled"):
            return True
        return sess is not None and sess.cancel_event.is_set()

    cancel_fn = _should_cancel if (sess is not None or fork_parallel_worker) else None
    ok, patch = execute_delay_or_debounce(
        node_id=node.id,
        graph_id=runner._doc.graph_id,
        wait_kind="debounce",
        data=dict(node.data),
        emit=runner.emit,
        should_cancel=cancel_fn,
    )
    if not ok and patch.get("processResult", {}).get("cancelled") is True:
        ctx["_gc_process_cancelled"] = True
    return _apply_timer_patch_to_outputs(runner, node, ctx, step_q, ok=ok, patch=patch)


def run_wait_for_visit(
    runner: Any,
    node: Node,
    ctx: dict[str, Any],
    step_q: StepQueue,
    *,
    fork_parallel_worker: bool = False,
) -> tuple[Literal["ok", "continue", "break"], bool]:
    """Poll until a workspace file exists or timeout (`wait_for` node, ``waitMode=file``)."""
    sess = ctx.get("_gc_run_session")

    def _should_cancel() -> bool:
        if fork_parallel_worker and ctx.get("_run_cancelled"):
            return True
        return sess is not None and sess.cancel_event.is_set()

    cancel_fn = _should_cancel if (sess is not None or fork_parallel_worker) else None
    ws = runner._host.resolved_workspace_root()
    ok, patch = execute_wait_for_file(
        node_id=node.id,
        graph_id=runner._doc.graph_id,
        data=dict(node.data),
        workspace_root=ws,
        emit=runner.emit,
        should_cancel=cancel_fn,
    )
    if not ok and patch.get("processResult", {}).get("cancelled") is True:
        ctx["_gc_process_cancelled"] = True
    return _apply_timer_patch_to_outputs(runner, node, ctx, step_q, ok=ok, patch=patch)
