# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import copy
import json
import logging
import os
import threading
import uuid
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from graph_caster.document_revision import graph_document_revision
from graph_caster.fork_parallel import EDGE_SOURCE_OUT_ERROR, ForkBranchPlan, build_fork_parallel_plans
from graph_caster.host_context import RunHostContext
from graph_caster.models import Edge, GraphDocument, Node, is_editor_frame_node_type
from graph_caster.nested_run_subprocess import graph_ref_subprocess_enabled, run_nested_graph_ref_subprocess
from graph_caster.node_output_cache import (
    StepCachePolicy,
    StepCacheStore,
    step_cache_root,
    validate_ai_route_step_cache_entry,
)
from graph_caster.run_event_sink import (
    NdjsonAppendFileSink,
    RunEventDict,
    RunEventSink,
    TeeRunEventSink,
    normalize_run_event_sink,
)
from graph_caster.run_sessions import RunSession, RunSessionRegistry
from graph_caster.step_queue import ExecutionFrame, StepQueue
from graph_caster.gc_pin import (
    apply_gc_pins_to_document_context,
    find_gc_pin_empty_payload_warnings,
)
from graph_caster.http_request_exec import redact_http_request_data_for_execute
from graph_caster.python_code_exec import redact_python_code_data_for_execute
from graph_caster.rag_query_exec import redact_rag_query_data_for_execute
from graph_caster.delay_wait_exec import redact_timer_node_data_for_execute
from graph_caster.mcp_client import redact_mcp_tool_data_for_execute
from graph_caster.process_exec import redact_task_data_for_node_execute, task_declares_env_keys
from graph_caster.port_data_kinds import find_port_data_kind_warnings
from graph_caster.validate import (
    find_ai_route_structure_warnings,
    find_barrier_merge_out_error_incoming,
    find_fork_few_outputs_warnings,
    find_http_request_structure_warnings,
    find_rag_query_structure_warnings,
    find_delay_structure_warnings,
    find_debounce_structure_warnings,
    find_wait_for_structure_warnings,
    find_python_code_structure_warnings,
    find_set_variable_structure_warnings,
    find_llm_agent_structure_warnings,
    find_mcp_tool_structure_warnings,
    merge_mode,
)
from graph_caster.runner.edge_routing import edges_from_source, evaluate_next_edge, fork_unconditional_edges
from graph_caster.runner.node_visits import (
    execute_mcp_tool_node,
    run_http_request_visit,
    run_rag_query_visit,
    run_delay_visit,
    run_debounce_visit,
    run_wait_for_visit,
    run_python_code_visit,
    run_set_variable_visit,
    run_llm_agent_visit,
    run_subprocess_task_visit,
)
from graph_caster.runner.step_cache_lookup import plan_step_cache_key
from graph_caster.runner.run_helpers import (
    cache_key_prefix,
    http_request_has_url,
    rag_query_has_url_and_query,
    delay_has_duration,
    debounce_has_duration,
    wait_for_has_executable_config,
    python_code_has_code,
    set_variable_has_valid_config,
    llm_agent_has_executable_command,
    normalize_run_id_candidate,
    node_wants_step_cache,
    prepare_context,
    run_mode_wire,
    task_has_process_command,
)

EventSink = Callable[[RunEventDict], None] | RunEventSink

BRANCH_SKIP_REASON_CONDITION_FALSE = "condition_false"
BRANCH_SKIP_REASON_AI_ROUTE_NOT_SELECTED = "ai_route_not_selected"

_LOG = logging.getLogger(__name__)


class GraphRunner:
    def __init__(
        self,
        document: GraphDocument,
        sink: EventSink | None = None,
        *,
        host: RunHostContext | None = None,
        graphs_root: Path | None = None,
        run_id: str | None = None,
        session_registry: RunSessionRegistry | None = None,
        stop_after_node_id: str | None = None,
        step_cache: StepCachePolicy | None = None,
        persist_run_events: bool = False,
        fork_max_parallel: int | None = None,
    ) -> None:
        if host is not None and graphs_root is not None:
            raise ValueError("pass only one of host= or graphs_root=")
        if host is None:
            host = RunHostContext(graphs_root=graphs_root)
        self._doc = document
        self._event_sink: RunEventSink = normalize_run_event_sink(sink)
        self._host = host
        self._run_id = run_id
        self._session_registry = session_registry
        self._stop_after_node_id = stop_after_node_id
        self._step_cache = step_cache
        self._persist_run_events = persist_run_events
        self._persist_file_sink: NdjsonAppendFileSink | None = None
        self._step_cache_store: StepCacheStore | None = None
        self._step_cache_no_artifacts: bool = False
        self._node_by_id: dict[str, Node] = {n.id: n for n in document.nodes}
        self._workspace_secrets_loaded = False
        self._workspace_secrets: dict[str, str] = {}
        self._secrets_file_fp_loaded = False
        self._secrets_file_fp: str = ""
        self._emit_lock = threading.Lock()
        self._state_lock = threading.RLock()
        if fork_max_parallel is not None:
            self._fork_max_parallel_cap = max(1, int(fork_max_parallel))
        else:
            raw = (os.environ.get("GC_FORK_MAX_PARALLEL") or "").strip()
            self._fork_max_parallel_cap = max(1, int(raw)) if raw.isdigit() else 1

    def _get_workspace_secrets(self) -> dict[str, str]:
        if not self._workspace_secrets_loaded:
            self._workspace_secrets_loaded = True
            root = self._host.resolved_workspace_root()
            if root is not None:
                from graph_caster.secrets_loader import load_workspace_secrets

                self._workspace_secrets = load_workspace_secrets(root)
        return self._workspace_secrets

    def _get_secrets_file_fingerprint(self) -> str:
        if not self._secrets_file_fp_loaded:
            self._secrets_file_fp_loaded = True
            from graph_caster.secrets_loader import secrets_file_fingerprint

            self._secrets_file_fp = secrets_file_fingerprint(self._host.resolved_workspace_root())
        return self._secrets_file_fp

    def _step_cache_workspace_secrets_fp(self, node_data: dict[str, Any]) -> str | None:
        if not task_declares_env_keys(node_data):
            return None
        return self._get_secrets_file_fingerprint()

    def _ensure_step_cache_store(self) -> StepCacheStore | None:
        pol = self._step_cache
        if pol is None or not pol.enabled:
            return None
        if self._step_cache_store is not None:
            return self._step_cache_store
        if self._step_cache_no_artifacts:
            return None
        ab = self._host.artifacts_base
        if ab is None:
            self._step_cache_no_artifacts = True
            return None
        self._step_cache_store = StepCacheStore(step_cache_root(ab, self._doc.graph_id))
        return self._step_cache_store

    def _incoming_success_sources(self, node_id: str) -> list[str]:
        src: list[str] = []
        for e in self._doc.edges:
            if e.target == node_id and e.source_handle != EDGE_SOURCE_OUT_ERROR:
                src.append(e.source)
        return sorted(frozenset(src))

    def _upstream_outputs_for_step_cache(
        self,
        node_id: str,
        ctx: dict[str, Any],
    ) -> tuple[dict[str, Any], str | None]:
        preds = self._incoming_success_sources(node_id)
        outs = ctx.get("node_outputs") or {}
        up: dict[str, Any] = {}
        for pid in preds:
            if pid not in outs:
                return {}, "upstream_incomplete"
            up[pid] = outs[pid]
        return up, None

    def _graph_ref_upstream_revision_pairs(
        self,
        node_id: str,
        ctx: dict[str, Any],
    ) -> list[tuple[str, str]]:
        """Pairs ``(graph_ref_predecessor_id, child_graph_document_revision_hex)`` for step-cache keys.

        Revision values are keyed by ``targetGraphId`` in ``_gc_nested_doc_revisions`` (one file per id in workspace).
        """
        preds = self._incoming_success_sources(node_id)
        rev_map: dict[str, str] = ctx.get("_gc_nested_doc_revisions") or {}
        pairs: list[tuple[str, str]] = []
        for pid in preds:
            pred = self._node_by_id.get(pid)
            if pred is None or pred.type != "graph_ref":
                continue
            raw_tgt = pred.data.get("targetGraphId") or pred.data.get("graphId")
            if not raw_tgt:
                continue
            target_id = str(raw_tgt)
            rev = rev_map.get(target_id)
            if rev:
                pairs.append((pid, rev))
        return pairs

    def emit(self, event_type: str, **payload: Any) -> None:
        ev: RunEventDict = {"type": event_type, **payload}
        rid = self._run_id
        if rid:
            ev["runId"] = rid
        with self._emit_lock:
            self._event_sink.emit(ev)

    def _merge_barrier_state(self, ctx: dict[str, Any]) -> dict[str, Any]:
        return ctx.setdefault("_gc_merge_barrier", {})

    def _barrier_required_sources(self, merge_id: str) -> frozenset[str]:
        req: set[str] = set()
        for e in self._doc.edges:
            if e.target != merge_id or e.source_handle == EDGE_SOURCE_OUT_ERROR:
                continue
            src = self._node_by_id.get(e.source)
            if src is None or is_editor_frame_node_type(src.type):
                continue
            req.add(e.source)
        return frozenset(req)

    def _merge_barrier_arrive(self, merge_id: str, from_source_id: str, ctx: dict[str, Any], step_q: StepQueue) -> None:
        with self._state_lock:
            stmap = self._merge_barrier_state(ctx)
            if merge_id not in stmap:
                stmap[merge_id] = {
                    "required": self._barrier_required_sources(merge_id),
                    "arrived": set(),
                    "scheduled": False,
                }
            st = stmap[merge_id]
            req = st["required"]
            if not req:
                return
            st["arrived"].add(from_source_id)
            if st["arrived"].issuperset(req) and not st["scheduled"]:
                st["scheduled"] = True
                step_q.append(ExecutionFrame(merge_id))

    def _has_incomplete_barrier(self, ctx: dict[str, Any]) -> bool:
        with self._state_lock:
            mb = ctx.get("_gc_merge_barrier") or {}
            for _, st in mb.items():
                req = st.get("required") or frozenset()
                if not req:
                    continue
                if st.get("scheduled"):
                    continue
                arr = st.get("arrived") or set()
                if arr != req:
                    return True
            return False

    def _traverse_chosen_edge(
        self,
        from_node_id: str,
        edge: Edge,
        ctx: dict[str, Any],
        step_q: StepQueue,
        *,
        emit_branch_taken: bool,
        error_route: bool,
    ) -> None:
        gid = self._doc.graph_id
        route_kw: dict[str, Any] = {}
        if error_route:
            route_kw["route"] = "error"
        if emit_branch_taken:
            self.emit(
                "branch_taken",
                edgeId=edge.id,
                fromNode=edge.source,
                toNode=edge.target,
                graphId=gid,
                **route_kw,
            )
        self.emit(
            "edge_traverse",
            edgeId=edge.id,
            fromNode=edge.source,
            toNode=edge.target,
            **route_kw,
        )
        if error_route:
            tgt_node = self._node_by_id.get(edge.target)
            if tgt_node is not None and tgt_node.type == "merge" and merge_mode(tgt_node) == "barrier":
                self.emit(
                    "error",
                    message="barrier_merge_error_path_not_supported",
                    mergeNodeId=edge.target,
                    edgeId=edge.id,
                    graphId=self._doc.graph_id,
                )
                return
            with self._state_lock:
                step_q.append(ExecutionFrame(edge.target))
            return
        tgt_node = self._node_by_id.get(edge.target)
        if tgt_node is not None and tgt_node.type == "merge" and merge_mode(tgt_node) == "barrier":
            self._merge_barrier_arrive(edge.target, from_node_id, ctx, step_q)
            return
        with self._state_lock:
            step_q.append(ExecutionFrame(edge.target))

    def _resolve_fork_max_parallel(self, fork_id: str, ctx: dict[str, Any]) -> int:
        cap = self._fork_max_parallel_cap
        fn = self._node_by_id.get(fork_id)
        if fn is not None:
            raw_mp = fn.data.get("maxParallel")
            if raw_mp is not None:
                try:
                    cap = min(cap, max(1, int(raw_mp)))
                except (TypeError, ValueError):
                    pass
        ctx_mp = ctx.get("fork_max_parallel")
        if ctx_mp is not None:
            try:
                cap = min(cap, max(1, int(ctx_mp)))
            except (TypeError, ValueError):
                pass
        return cap

    def _fork_plans_single_layer_process_tasks(self, plans: list[ForkBranchPlan]) -> bool:
        for p in plans:
            if len(p.node_ids) != 1:
                return False
            n = self._node_by_id.get(p.node_ids[0])
            if n is None:
                return False
            if n.type == "task" and task_has_process_command(n):
                continue
            if n.type == "llm_agent" and llm_agent_has_executable_command(n):
                continue
            if n.type == "http_request" and http_request_has_url(n):
                continue
            if n.type == "rag_query" and rag_query_has_url_and_query(n):
                continue
            if n.type == "python_code" and python_code_has_code(n):
                continue
            if n.type == "set_variable" and set_variable_has_valid_config(n):
                continue
            if n.type == "delay" and delay_has_duration(n):
                continue
            if n.type == "debounce" and debounce_has_duration(n):
                continue
            if n.type == "wait_for" and wait_for_has_executable_config(n):
                continue
            return False
        return True

    def _emit_fork_parallel_frontier_events(self, fork_id: str, plans: list[ForkBranchPlan]) -> None:
        by_eid = {e.id: e for e in self._doc.edges}
        gid = self._doc.graph_id
        multi = len(plans) > 1
        for p in plans:
            edge = by_eid.get(p.first_edge_id)
            if edge is None:
                continue
            if multi:
                self.emit(
                    "branch_taken",
                    edgeId=edge.id,
                    fromNode=edge.source,
                    toNode=edge.target,
                    graphId=gid,
                )
            self.emit(
                "edge_traverse",
                edgeId=edge.id,
                fromNode=edge.source,
                toNode=edge.target,
                graphId=gid,
            )

    def _fork_worker_begin_task_visit(self, node: Node, ctx: dict[str, Any]) -> None:
        red_task = redact_task_data_for_node_execute(node.data)
        exec_data = red_task
        stored_node_data = dict(node.data) if red_task is node.data else red_task
        self.emit("node_enter", nodeId=node.id, nodeType=node.type, graphId=self._doc.graph_id)
        self.emit("node_execute", nodeId=node.id, nodeType=node.type, data=exec_data)
        outs_map = ctx.setdefault("node_outputs", {})
        prev_out = outs_map.get(node.id)
        outs_map[node.id] = {"nodeType": node.type, "data": stored_node_data}
        if isinstance(prev_out, dict):
            for k, v in prev_out.items():
                if k not in ("nodeType", "data"):
                    outs_map[node.id][k] = copy.deepcopy(v)

    def _run_subprocess_task_visit(
        self,
        node: Node,
        ctx: dict[str, Any],
        step_q: StepQueue,
        *,
        fork_parallel_worker: bool = False,
    ) -> tuple[Literal["ok", "continue", "break"], bool]:
        return run_subprocess_task_visit(
            self, node, ctx, step_q, fork_parallel_worker=fork_parallel_worker
        )

    def _run_llm_agent_visit(
        self,
        node: Node,
        ctx: dict[str, Any],
        step_q: StepQueue,
        *,
        fork_parallel_worker: bool = False,
    ) -> tuple[Literal["ok", "continue", "break"], bool]:
        return run_llm_agent_visit(
            self, node, ctx, step_q, fork_parallel_worker=fork_parallel_worker
        )

    def _run_http_request_visit(
        self,
        node: Node,
        ctx: dict[str, Any],
        step_q: StepQueue,
        *,
        fork_parallel_worker: bool = False,
    ) -> tuple[Literal["ok", "continue", "break"], bool]:
        return run_http_request_visit(
            self, node, ctx, step_q, fork_parallel_worker=fork_parallel_worker
        )

    def _run_rag_query_visit(
        self,
        node: Node,
        ctx: dict[str, Any],
        step_q: StepQueue,
        *,
        fork_parallel_worker: bool = False,
    ) -> tuple[Literal["ok", "continue", "break"], bool]:
        return run_rag_query_visit(
            self, node, ctx, step_q, fork_parallel_worker=fork_parallel_worker
        )

    def _run_python_code_visit(
        self,
        node: Node,
        ctx: dict[str, Any],
        step_q: StepQueue,
        *,
        fork_parallel_worker: bool = False,
    ) -> tuple[Literal["ok", "continue", "break"], bool]:
        return run_python_code_visit(
            self, node, ctx, step_q, fork_parallel_worker=fork_parallel_worker
        )

    def _run_set_variable_visit(
        self,
        node: Node,
        ctx: dict[str, Any],
        step_q: StepQueue,
        *,
        fork_parallel_worker: bool = False,
    ) -> tuple[Literal["ok", "continue", "break"], bool]:
        return run_set_variable_visit(
            self, node, ctx, step_q, fork_parallel_worker=fork_parallel_worker
        )

    def _run_delay_visit(
        self,
        node: Node,
        ctx: dict[str, Any],
        step_q: StepQueue,
        *,
        fork_parallel_worker: bool = False,
    ) -> tuple[Literal["ok", "continue", "break"], bool]:
        return run_delay_visit(self, node, ctx, step_q, fork_parallel_worker=fork_parallel_worker)

    def _run_debounce_visit(
        self,
        node: Node,
        ctx: dict[str, Any],
        step_q: StepQueue,
        *,
        fork_parallel_worker: bool = False,
    ) -> tuple[Literal["ok", "continue", "break"], bool]:
        return run_debounce_visit(self, node, ctx, step_q, fork_parallel_worker=fork_parallel_worker)

    def _run_wait_for_visit(
        self,
        node: Node,
        ctx: dict[str, Any],
        step_q: StepQueue,
        *,
        fork_parallel_worker: bool = False,
    ) -> tuple[Literal["ok", "continue", "break"], bool]:
        return run_wait_for_visit(self, node, ctx, step_q, fork_parallel_worker=fork_parallel_worker)

    def _fork_parallel_branch_worker(self, plan: ForkBranchPlan, ctx: dict[str, Any], step_q: StepQueue) -> None:
        if ctx.get("_run_cancelled"):
            return
        nid = plan.node_ids[0]
        node = self._node_by_id.get(nid)
        if node is None:
            return
        try:
            from graph_caster import otel_tracing

            _otel_t = otel_tracing.get_tracer()
            with otel_tracing.node_visit_span(
                _otel_t,
                run_id=str(ctx.get("run_id") or ""),
                graph_id=self._doc.graph_id,
                node_id=node.id,
                node_type=str(node.type),
            ):
                self._fork_worker_begin_task_visit(node, ctx)
                if node.type == "task" and task_has_process_command(node):
                    outcome, used_pin = self._run_subprocess_task_visit(
                        node, ctx, step_q, fork_parallel_worker=True
                    )
                elif node.type == "llm_agent":
                    outcome, used_pin = self._run_llm_agent_visit(
                        node, ctx, step_q, fork_parallel_worker=True
                    )
                elif node.type == "http_request":
                    outcome, used_pin = self._run_http_request_visit(
                        node, ctx, step_q, fork_parallel_worker=True
                    )
                elif node.type == "rag_query":
                    outcome, used_pin = self._run_rag_query_visit(
                        node, ctx, step_q, fork_parallel_worker=True
                    )
                elif node.type == "python_code":
                    outcome, used_pin = self._run_python_code_visit(
                        node, ctx, step_q, fork_parallel_worker=True
                    )
                elif node.type == "set_variable":
                    outcome, used_pin = self._run_set_variable_visit(
                        node, ctx, step_q, fork_parallel_worker=True
                    )
                elif node.type == "delay":
                    outcome, used_pin = self._run_delay_visit(
                        node, ctx, step_q, fork_parallel_worker=True
                    )
                elif node.type == "debounce":
                    outcome, used_pin = self._run_debounce_visit(
                        node, ctx, step_q, fork_parallel_worker=True
                    )
                elif node.type == "wait_for":
                    outcome, used_pin = self._run_wait_for_visit(
                        node, ctx, step_q, fork_parallel_worker=True
                    )
                else:
                    return
                if ctx.get("_run_cancelled"):
                    return
                if outcome == "ok":
                    ne: dict[str, Any] = {
                        "nodeId": node.id,
                        "nodeType": node.type,
                        "graphId": self._doc.graph_id,
                    }
                    if used_pin:
                        ne["usedPin"] = True
                    self.emit("node_exit", **ne)
                    self._merge_barrier_arrive(plan.merge_id, plan.arrive_source, ctx, step_q)
                else:
                    otel_tracing.mark_current_span_error(f"{node.type}_fork_parallel_non_ok")
        except BaseException:
            ctx["_run_cancelled"] = True

    def _run_fork_parallel_branches(
        self,
        fork_id: str,
        plans: list[ForkBranchPlan],
        ctx: dict[str, Any],
        step_q: StepQueue,
        max_workers: int,
    ) -> None:
        self._emit_fork_parallel_frontier_events(fork_id, plans)
        n_workers = max(1, min(max_workers, len(plans)))
        with ThreadPoolExecutor(max_workers=n_workers) as ex:
            futures = [ex.submit(self._fork_parallel_branch_worker, p, ctx, step_q) for p in plans]
            for fut in as_completed(futures):
                fut.result()

    def _enqueue_fork_branches(self, fork_id: str, ctx: dict[str, Any], step_q: StepQueue) -> bool:
        edges = fork_unconditional_edges(self._doc, fork_id, self._node_by_id)
        if not edges:
            self.emit("run_end", reason="fork_no_unconditional_outgoing")
            return False

        plans, plan_reason = build_fork_parallel_plans(self._doc, fork_id, self._node_by_id)
        mp = self._resolve_fork_max_parallel(fork_id, ctx)

        deferred_parallel = (
            plans is not None
            and len(plans) >= 2
            and mp >= 2
            and self._stop_after_node_id is None
            and not self._fork_plans_single_layer_process_tasks(plans)
        )
        if deferred_parallel:
            self.emit(
                "structure_warning",
                kind="fork_parallel_deferred",
                forkNodeId=fork_id,
                reason="multi_hop_or_non_subprocess_task",
                graphId=self._doc.graph_id,
            )

        parallel_ok = (
            plans is not None
            and len(plans) >= 2
            and mp >= 2
            and self._stop_after_node_id is None
            and self._fork_plans_single_layer_process_tasks(plans)
        )
        if parallel_ok:
            workers = min(mp, len(plans))
            self._run_fork_parallel_branches(fork_id, plans, ctx, step_q, workers)
            return True

        if plans is None and plan_reason is not None and mp >= 2:
            self.emit(
                "structure_warning",
                kind="fork_parallel_region_unsupported",
                forkNodeId=fork_id,
                reason=plan_reason,
                graphId=self._doc.graph_id,
            )

        multi = len(edges) > 1
        for e in edges:
            self._traverse_chosen_edge(
                fork_id,
                e,
                ctx,
                step_q,
                emit_branch_taken=multi,
                error_route=False,
            )
        return True

    def _follow_ai_route_from(self, node: Node, ctx: dict[str, Any], step_q: StepQueue) -> bool:
        from graph_caster.ai_routing import (
            build_ai_route_request,
            encode_ai_route_wire_body,
            resolve_ai_route_choice,
            usable_ai_route_out_edges,
        )

        gid = self._doc.graph_id
        rid = str(ctx.get("run_id") or self._run_id or "")
        outgoing = usable_ai_route_out_edges(self._doc, node.id)
        n_out = len(outgoing)
        preds = self._incoming_success_sources(node.id)
        outs_map = ctx.setdefault("node_outputs", {})

        graph_rev = str(ctx.get("graph_rev") or "")
        tenant_id = ctx.get("tenant_id")
        tenant_s = str(tenant_id).strip() if tenant_id is not None else None
        parent_ref = str(ctx.get("_parent_graph_ref_node_id") or "").strip()
        pol = self._step_cache
        store = self._ensure_step_cache_store()
        want_cache = node_wants_step_cache(node)
        prov = ctx.get("ai_route_provider")
        provider_override = prov if callable(prov) else None
        dirty = bool(
            pol
            and pol.enabled
            and (
                node.id in pol.dirty_nodes
                or (parent_ref != "" and parent_ref in pol.dirty_nodes)
            )
        )
        # Step cache applies even when ``ai_route_provider`` overrides HTTP: the
        # cache stores the resolved branch (choiceIndex, edgeId); replays must
        # not re-invoke the provider or the network.
        cache_active = (
            want_cache
            and pol is not None
            and pol.enabled
            and store is not None
        )
        used_step_cache = False
        cache_key: str | None = None
        upstream_incomplete = False
        cache_ws_fp: str | None = (
            self._step_cache_workspace_secrets_fp(node.data) if cache_active else None
        )

        if cache_active:
            up, inc_reason = self._upstream_outputs_for_step_cache(node.id, ctx)
            gr_pairs = self._graph_ref_upstream_revision_pairs(node.id, ctx)
            plan = plan_step_cache_key(
                self.emit,
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
                cache_node_kind="ai_route",
            )
            cache_key = plan.cache_key
            upstream_incomplete = plan.upstream_incomplete
            if plan.try_read_cache and cache_key is not None and store is not None:
                cached = store.get(cache_key)
                if cached is not None and validate_ai_route_step_cache_entry(self._doc, node.id, cached):
                    ar = cached["aiRoute"]
                    idx_1based = int(ar["choiceIndex"])
                    edge_id = str(ar["edgeId"])
                    chosen = next((e for e in outgoing if e.id == edge_id), None)
                    if chosen is None:
                        self.emit(
                            "node_cache_miss",
                            nodeId=node.id,
                            graphId=gid,
                            keyPrefix=cache_key_prefix(cache_key),
                            reason="stale_structure",
                        )
                    else:
                        outs_map[node.id] = copy.deepcopy(cached)
                        self.emit(
                            "node_cache_hit",
                            nodeId=node.id,
                            graphId=gid,
                            keyPrefix=cache_key_prefix(cache_key),
                        )
                        self.emit(
                            "ai_route_decided",
                            nodeId=node.id,
                            graphId=gid,
                            choiceIndex=idx_1based,
                            edgeId=chosen.id,
                        )
                        used_step_cache = True
                        for e in outgoing:
                            if e.id == chosen.id:
                                continue
                            self.emit(
                                "branch_skipped",
                                edgeId=e.id,
                                fromNode=e.source,
                                toNode=e.target,
                                graphId=gid,
                                reason=BRANCH_SKIP_REASON_AI_ROUTE_NOT_SELECTED,
                            )
                        multi = n_out > 1
                        self._traverse_chosen_edge(
                            node.id,
                            chosen,
                            ctx,
                            step_q,
                            emit_branch_taken=multi,
                            error_route=False,
                        )
                        return True
                elif cached is not None:
                    self.emit(
                        "node_cache_miss",
                        nodeId=node.id,
                        graphId=gid,
                        keyPrefix=cache_key_prefix(cache_key),
                        reason="stale_structure",
                    )
                else:
                    self.emit(
                        "node_cache_miss",
                        nodeId=node.id,
                        graphId=gid,
                        keyPrefix=cache_key_prefix(cache_key),
                    )

        req_bytes = 0
        if not used_step_cache:
            if n_out >= 2:
                max_req = int(node.data.get("maxRequestJsonBytes") or 65536)
                if max_req < 256:
                    max_req = 256
                body, err = build_ai_route_request(
                    doc=self._doc,
                    node=node,
                    outgoing=outgoing,
                    ctx=ctx,
                    run_id=rid,
                    max_request_bytes=max_req,
                    preds=preds,
                )
                if body is not None:
                    req_bytes = len(encode_ai_route_wire_body(body))
            self.emit(
                "ai_route_invoke",
                nodeId=node.id,
                graphId=gid,
                outgoingCount=n_out,
                requestBytes=req_bytes,
            )
        outcome = resolve_ai_route_choice(
            doc=self._doc,
            node=node,
            ctx=ctx,
            run_id=rid,
            preds=preds,
            provider_override=provider_override,
        )
        chosen = outcome.chosen
        if chosen is None and outcome.error_reason:
            self.emit(
                "ai_route_failed",
                nodeId=node.id,
                graphId=gid,
                reason=outcome.error_reason,
                detail=outcome.error_detail,
            )
            on_fail = str(node.data.get("onFailure") or "stop_run").strip().lower()
            if on_fail == "fallback" and n_out > 0:
                fb = int(node.data.get("fallbackChoiceIndex") or 1)
                if 1 <= fb <= n_out:
                    chosen = outgoing[fb - 1]
            if chosen is None:
                self.emit(
                    "error",
                    nodeId=node.id,
                    message=f"ai_route_failed:{outcome.error_reason}",
                )
                ctx["last_result"] = False
                return False

        assert chosen is not None
        idx_1based = next((i for i, e in enumerate(outgoing, start=1) if e.id == chosen.id), None)
        if idx_1based is None:
            self.emit(
                "error",
                nodeId=node.id,
                message="ai_route_internal:chosen_edge_not_in_outgoing",
            )
            ctx["last_result"] = False
            return False
        self.emit(
            "ai_route_decided",
            nodeId=node.id,
            graphId=gid,
            choiceIndex=idx_1based,
            edgeId=chosen.id,
        )
        entry = outs_map.get(node.id)
        ar_meta = {"choiceIndex": idx_1based, "edgeId": chosen.id}
        if isinstance(entry, dict):
            entry["aiRoute"] = ar_meta
        else:
            outs_map[node.id] = {"nodeType": node.type, "data": dict(node.data), "aiRoute": ar_meta}
        for e in outgoing:
            if e.id == chosen.id:
                continue
            self.emit(
                "branch_skipped",
                edgeId=e.id,
                fromNode=e.source,
                toNode=e.target,
                graphId=gid,
                reason=BRANCH_SKIP_REASON_AI_ROUTE_NOT_SELECTED,
            )
        if (
            not used_step_cache
            and cache_active
            and cache_key is not None
            and store is not None
            and not upstream_incomplete
        ):
            store.put(cache_key, copy.deepcopy(outs_map[node.id]))
        multi = n_out > 1
        self._traverse_chosen_edge(
            node.id,
            chosen,
            ctx,
            step_q,
            emit_branch_taken=multi,
            error_route=False,
        )
        return True

    def _execute_mcp_tool(self, node: Node, ctx: dict[str, Any]) -> bool:
        return execute_mcp_tool_node(self, node, ctx)

    def _follow_edges_from(
        self,
        node_id: str,
        ctx: dict[str, Any],
        *,
        error_route: bool,
        step_q: StepQueue,
    ) -> bool:
        outs = edges_from_source(node_id, self._doc, error_route=error_route)
        chosen, skipped_edges = evaluate_next_edge(outs, ctx)
        gid = self._doc.graph_id
        for e in skipped_edges:
            self.emit(
                "branch_skipped",
                edgeId=e.id,
                fromNode=e.source,
                toNode=e.target,
                graphId=gid,
                reason=BRANCH_SKIP_REASON_CONDITION_FALSE,
            )
        if chosen is None:
            if (not error_route) or outs:
                self.emit("run_end", reason="no_outgoing_or_no_matching_condition")
            return False
        emit_branch_taken = len(outs) > 1 or bool(skipped_edges)
        self._traverse_chosen_edge(
            node_id,
            chosen,
            ctx,
            step_q,
            emit_branch_taken=emit_branch_taken,
            error_route=error_route,
        )
        return True

    def _run_from_execution_phase(
        self, start_node_id: str, ctx: dict[str, Any], nd0: int, otel_tracer: Any
    ) -> None:
        from graph_caster import otel_tracing
        from graph_caster.validate import (
            find_barrier_merge_no_success_incoming_warnings,
            find_merge_incoming_warnings,
        )

        for w in find_merge_incoming_warnings(self._doc):
            self.emit(
                "structure_warning",
                kind="merge_few_inputs",
                nodeId=w["nodeId"],
                incomingEdges=w["incomingEdges"],
                graphId=self._doc.graph_id,
            )
        for w in find_fork_few_outputs_warnings(self._doc):
            self.emit(
                "structure_warning",
                kind="fork_few_outputs",
                nodeId=w["nodeId"],
                unconditionalOutgoing=w["unconditionalOutgoing"],
                graphId=self._doc.graph_id,
            )
        for w in find_barrier_merge_out_error_incoming(self._doc):
            self.emit(
                "structure_warning",
                kind="barrier_merge_out_error_incoming",
                edgeId=w["edgeId"],
                mergeNodeId=w["mergeNodeId"],
                graphId=self._doc.graph_id,
            )
        for w in find_barrier_merge_no_success_incoming_warnings(self._doc):
            self.emit(
                "structure_warning",
                kind="barrier_merge_no_success_incoming",
                nodeId=w["nodeId"],
                graphId=self._doc.graph_id,
            )
        for w in find_gc_pin_empty_payload_warnings(self._doc):
            self.emit(
                "structure_warning",
                kind="gc_pin_enabled_empty_payload",
                nodeId=w["nodeId"],
                graphId=self._doc.graph_id,
            )
        for w in find_ai_route_structure_warnings(self._doc):
            self.emit("structure_warning", graphId=self._doc.graph_id, **w)
        for w in find_mcp_tool_structure_warnings(self._doc):
            self.emit("structure_warning", graphId=self._doc.graph_id, **w)
        for w in find_http_request_structure_warnings(self._doc):
            self.emit("structure_warning", graphId=self._doc.graph_id, **w)
        for w in find_rag_query_structure_warnings(self._doc):
            self.emit("structure_warning", graphId=self._doc.graph_id, **w)
        for w in find_python_code_structure_warnings(self._doc):
            self.emit("structure_warning", graphId=self._doc.graph_id, **w)
        for w in find_set_variable_structure_warnings(self._doc):
            self.emit("structure_warning", graphId=self._doc.graph_id, **w)
        for w in find_delay_structure_warnings(self._doc):
            self.emit("structure_warning", graphId=self._doc.graph_id, **w)
        for w in find_debounce_structure_warnings(self._doc):
            self.emit("structure_warning", graphId=self._doc.graph_id, **w)
        for w in find_wait_for_structure_warnings(self._doc):
            self.emit("structure_warning", graphId=self._doc.graph_id, **w)
        for w in find_llm_agent_structure_warnings(self._doc):
            self.emit("structure_warning", graphId=self._doc.graph_id, **w)
        # Same warnings may already appear in the editor from the graph document; NDJSON is for console parity.
        for w in find_port_data_kind_warnings(self._doc):
            self.emit("structure_warning", graphId=self._doc.graph_id, **w)
        ctx["graph_rev"] = graph_document_revision(self._doc)
        step_q = StepQueue(start_node_id)
        visited_guard = 0
        max_steps = max(1, len(self._doc.nodes) * 4)

        while step_q and visited_guard < max_steps:
            visited_guard += 1
            sess_coop = ctx.get("_gc_run_session")
            if sess_coop is not None and sess_coop.cancel_event.is_set():
                if nd0 == 0:
                    self.emit("run_end", reason="cancel_requested")
                ctx["_run_cancelled"] = True
                break
            frame = step_q.popleft()
            current_id = frame.node_id
            node = self._node_by_id.get(current_id)
            if node is None:
                self.emit("error", nodeId=current_id, message="unknown_node")
                break

            with otel_tracing.node_visit_span(
                otel_tracer,
                run_id=str(ctx.get("run_id") or ""),
                graph_id=self._doc.graph_id,
                node_id=node.id,
                node_type=str(node.type),
            ):
                self.emit("node_enter", nodeId=node.id, nodeType=node.type, graphId=self._doc.graph_id)
                if node.type == "task":
                    red_task = redact_task_data_for_node_execute(node.data)
                    exec_data = red_task
                    stored_node_data = dict(node.data) if red_task is node.data else red_task
                elif node.type == "llm_agent":
                    red_a = redact_task_data_for_node_execute(node.data)
                    exec_data = red_a
                    stored_node_data = dict(node.data) if red_a is node.data else red_a
                elif node.type == "mcp_tool":
                    red_m = redact_mcp_tool_data_for_execute(node.data)
                    exec_data = red_m
                    stored_node_data = dict(node.data) if red_m is node.data else red_m
                elif node.type == "http_request":
                    red_h = redact_http_request_data_for_execute(dict(node.data))
                    exec_data = red_h
                    stored_node_data = dict(node.data) if red_h is node.data else red_h
                elif node.type == "rag_query":
                    red_r = redact_rag_query_data_for_execute(dict(node.data))
                    exec_data = red_r
                    stored_node_data = dict(node.data) if red_r is node.data else red_r
                elif node.type == "python_code":
                    red_p = redact_python_code_data_for_execute(dict(node.data))
                    exec_data = red_p
                    stored_node_data = dict(node.data) if red_p is node.data else red_p
                elif node.type == "set_variable":
                    exec_data = dict(node.data)
                    stored_node_data = dict(node.data)
                elif node.type in ("delay", "debounce", "wait_for"):
                    red_t = redact_timer_node_data_for_execute(dict(node.data))
                    exec_data = red_t
                    stored_node_data = dict(node.data) if red_t is node.data else red_t
                else:
                    exec_data = node.data
                    stored_node_data = dict(node.data)
                self.emit("node_execute", nodeId=node.id, nodeType=node.type, data=exec_data)

                task_exit_used_pin = False
                outs_map = ctx.setdefault("node_outputs", {})
                prev_out = outs_map.get(node.id)
                outs_map[node.id] = {"nodeType": node.type, "data": stored_node_data}
                if isinstance(prev_out, dict):
                    for k, v in prev_out.items():
                        if k not in ("nodeType", "data"):
                            outs_map[node.id][k] = copy.deepcopy(v)
                if node.type == "fork":
                    outs_map[node.id]["fork"] = True
                elif node.type == "merge":
                    if merge_mode(node) == "barrier":
                        with self._state_lock:
                            st = (ctx.get("_gc_merge_barrier") or {}).get(node.id, {})
                            arrived = set(st.get("arrived") or set())
                        outs_map[node.id]["merge"] = {
                            "passthrough": False,
                            "barrier": True,
                            "arrivedFrom": sorted(arrived),
                        }
                    else:
                        outs_map[node.id]["merge"] = {"passthrough": True}

                if is_editor_frame_node_type(node.type):
                    pass
                elif node.type == "graph_ref":
                    ok = self._execute_graph_ref(node, ctx)
                    if not ok:
                        otel_tracing.mark_current_span_error("graph_ref_failed")
                        self.emit("node_exit", nodeId=node.id, nodeType=node.type, graphId=self._doc.graph_id)
                        if not ctx.get("_run_cancelled"):
                            ctx["last_result"] = False
                            if self._follow_edges_from(node.id, ctx, error_route=True, step_q=step_q):
                                continue
                        break
                elif node.type == "mcp_tool":
                    ok = self._execute_mcp_tool(node, ctx)
                    if not ok:
                        otel_tracing.mark_current_span_error("mcp_tool_failed")
                        self.emit("node_exit", nodeId=node.id, nodeType=node.type, graphId=self._doc.graph_id)
                        if not ctx.get("_run_cancelled"):
                            ctx["last_result"] = False
                            if self._follow_edges_from(node.id, ctx, error_route=True, step_q=step_q):
                                continue
                        break
                elif node.type == "http_request":
                    outcome, _pin_http = self._run_http_request_visit(
                        node, ctx, step_q, fork_parallel_worker=False
                    )
                    if outcome == "continue":
                        otel_tracing.mark_current_span_error("http_request_continue_non_ok")
                        continue
                    if outcome == "break":
                        otel_tracing.mark_current_span_error("http_request_break_non_ok")
                        break
                elif node.type == "rag_query":
                    outcome, _pin_rag = self._run_rag_query_visit(
                        node, ctx, step_q, fork_parallel_worker=False
                    )
                    if outcome == "continue":
                        otel_tracing.mark_current_span_error("rag_query_continue_non_ok")
                        continue
                    if outcome == "break":
                        otel_tracing.mark_current_span_error("rag_query_break_non_ok")
                        break
                elif node.type == "python_code":
                    outcome, _pin_py = self._run_python_code_visit(
                        node, ctx, step_q, fork_parallel_worker=False
                    )
                    if outcome == "continue":
                        otel_tracing.mark_current_span_error("python_code_continue_non_ok")
                        continue
                    if outcome == "break":
                        otel_tracing.mark_current_span_error("python_code_break_non_ok")
                        break
                elif node.type == "set_variable":
                    outcome, _pin_sv = self._run_set_variable_visit(
                        node, ctx, step_q, fork_parallel_worker=False
                    )
                    if outcome == "continue":
                        otel_tracing.mark_current_span_error("set_variable_continue_non_ok")
                        continue
                    if outcome == "break":
                        otel_tracing.mark_current_span_error("set_variable_break_non_ok")
                        break
                elif node.type == "delay":
                    outcome, _pin_d = self._run_delay_visit(
                        node, ctx, step_q, fork_parallel_worker=False
                    )
                    if outcome == "continue":
                        otel_tracing.mark_current_span_error("delay_continue_non_ok")
                        continue
                    if outcome == "break":
                        otel_tracing.mark_current_span_error("delay_break_non_ok")
                        break
                elif node.type == "debounce":
                    outcome, _pin_db = self._run_debounce_visit(
                        node, ctx, step_q, fork_parallel_worker=False
                    )
                    if outcome == "continue":
                        otel_tracing.mark_current_span_error("debounce_continue_non_ok")
                        continue
                    if outcome == "break":
                        otel_tracing.mark_current_span_error("debounce_break_non_ok")
                        break
                elif node.type == "wait_for":
                    outcome, _pin_w = self._run_wait_for_visit(
                        node, ctx, step_q, fork_parallel_worker=False
                    )
                    if outcome == "continue":
                        otel_tracing.mark_current_span_error("wait_for_continue_non_ok")
                        continue
                    if outcome == "break":
                        otel_tracing.mark_current_span_error("wait_for_break_non_ok")
                        break
                elif node.type == "llm_agent":
                    outcome, _pin_u = self._run_llm_agent_visit(
                        node, ctx, step_q, fork_parallel_worker=False
                    )
                    if outcome == "continue":
                        otel_tracing.mark_current_span_error("llm_agent_continue_non_ok")
                        continue
                    if outcome == "break":
                        otel_tracing.mark_current_span_error("llm_agent_break_non_ok")
                        break
                elif node.type == "task" and task_has_process_command(node):
                    outcome, task_exit_used_pin = self._run_subprocess_task_visit(
                        node, ctx, step_q, fork_parallel_worker=False
                    )
                    if outcome == "continue":
                        otel_tracing.mark_current_span_error("task_continue_non_ok")
                        continue
                    if outcome == "break":
                        otel_tracing.mark_current_span_error("task_break_non_ok")
                        break

                self._merge_run_variables_from_node_output(ctx, node.id)

                ne: dict[str, Any] = {
                    "nodeId": node.id,
                    "nodeType": node.type,
                    "graphId": self._doc.graph_id,
                }
                if task_exit_used_pin:
                    ne["usedPin"] = True
                if node.type != "ai_route":
                    self.emit("node_exit", **ne)

                if node.type == "exit":
                    self.emit("run_success", nodeId=node.id, graphId=self._doc.graph_id)
                    ctx["_run_success"] = True
                    break

                if (
                    self._stop_after_node_id is not None
                    and self._stop_after_node_id == node.id
                    and not ctx.get("_run_cancelled")
                ):
                    ctx["_run_partial_stop"] = True
                    break

                if node.type == "fork":
                    if not self._enqueue_fork_branches(node.id, ctx, step_q):
                        otel_tracing.mark_current_span_error("fork_enqueue_failed")
                        break
                    continue
                if node.type == "ai_route":
                    ctx["last_result"] = True
                    ok_ai = self._follow_ai_route_from(node, ctx, step_q)
                    self.emit("node_exit", **ne)
                    if not ok_ai:
                        otel_tracing.mark_current_span_error("ai_route_failed")
                        break
                    continue
                if not self._follow_edges_from(node.id, ctx, error_route=False, step_q=step_q):
                    otel_tracing.mark_current_span_error("no_successor_edges")
                    break

        if visited_guard >= max_steps:
            self.emit("error", message="run_aborted_cycle_guard")
        elif (
            not ctx.get("_run_success")
            and not ctx.get("_run_cancelled")
            and not ctx.get("_run_partial_stop")
            and self._has_incomplete_barrier(ctx)
        ):
            self.emit("error", message="merge_barrier_incomplete")

    def _run_from_root_finally(self, ctx: dict[str, Any], nd0: int, root_span: Any) -> None:
        if nd0 == 0 and self._run_id:
            if ctx.get("_run_cancelled"):
                st = "cancelled"
            elif ctx.get("_run_partial_stop"):
                st = "partial"
            elif ctx.get("_run_success"):
                st = "success"
            else:
                st = "failed"
            finished_at = datetime.now(UTC).isoformat()
            self.emit(
                "run_finished",
                rootGraphId=self._doc.graph_id,
                status=st,
                finishedAt=finished_at,
            )
            _notify_payload: dict[str, Any] = {
                "schemaVersion": 1,
                "type": "run_finished",
                "runId": self._run_id,
                "rootGraphId": self._doc.graph_id,
                "status": st,
                "finishedAt": finished_at,
            }
            try:
                from graph_caster.run_notifications import deliver_run_finished_webhook_maybe

                deliver_run_finished_webhook_maybe(_notify_payload)
            except Exception:
                _LOG.debug("run_finished notify webhook failed", exc_info=True)
            try:
                from graph_caster.run_audit import append_run_finished_audit_maybe

                wr = self._host.resolved_workspace_root()
                append_run_finished_audit_maybe(
                    _notify_payload,
                    workspace_root=wr,
                )
            except Exception:
                _LOG.debug("run_finished audit append failed", exc_info=True)
            try:
                from graph_caster.run_plugin_hook import invoke_run_finished_module_maybe

                invoke_run_finished_module_maybe(_notify_payload)
            except Exception:
                _LOG.debug("run_finished plugin hook failed", exc_info=True)
            try:
                if self._persist_run_events:
                    rrd = ctx.get("root_run_artifact_dir")
                    if rrd:
                        from graph_caster.artifacts import write_run_summary

                        summary_payload: dict[str, Any] = {
                            "schemaVersion": 1,
                            "runId": self._run_id,
                            "rootGraphId": self._doc.graph_id,
                            "status": st,
                            "startedAt": ctx.get("_gc_started_at_iso"),
                            "finishedAt": finished_at,
                        }
                        rrd_path = Path(str(rrd))
                        write_run_summary(rrd_path, summary_payload)
                        ab_host = self._host.artifacts_base
                        if ab_host is not None:
                            try:
                                from graph_caster.run_catalog import upsert_run_from_summary

                                upsert_run_from_summary(Path(ab_host), rrd_path, summary_payload)
                            except Exception:
                                _LOG.debug("run_catalog upsert after summary failed", exc_info=True)
                            try:
                                from graph_caster.artifacts_s3 import schedule_run_dir_upload_maybe

                                schedule_run_dir_upload_maybe(
                                    rrd_path,
                                    graph_id=self._doc.graph_id,
                                    run_id=self._run_id,
                                )
                            except Exception:
                                _LOG.debug("S3 schedule after summary failed", exc_info=True)
            finally:
                if self._persist_file_sink is not None:
                    self._persist_file_sink.close()
                    self._persist_file_sink = None
                if self._session_registry is not None:
                    self._session_registry.complete(self._run_id, st)

        from graph_caster import otel_tracing
        otel_tracing.finalize_root_run_span(root_span, ctx)

    def run(self, context: dict[str, Any] | None = None, start_node_id: str | None = None) -> None:
        from graph_caster.validate import validate_graph_structure

        ctx = prepare_context(context)
        if start_node_id is not None:
            entry = start_node_id
        else:
            entry = validate_graph_structure(self._doc)
        self.run_from(entry, ctx)

    def run_from(self, start_node_id: str, context: dict[str, Any] | None = None) -> None:
        ctx = prepare_context(context)
        gr = self._host.graphs_root
        if gr is not None:
            ctx["_gc_graphs_root"] = str(gr.resolve())
        apply_gc_pins_to_document_context(self._doc, ctx)
        pool = ctx.setdefault("run_variables", {})
        if not isinstance(pool, dict):
            pool = {}
            ctx["run_variables"] = pool
        if self._doc.variables:
            merged = dict(self._doc.variables)
            merged.update(pool)
            pool.clear()
            pool.update(merged)
        ctx["_run_success"] = False
        ctx.pop("_run_partial_stop", None)
        nd0 = int(ctx.get("nesting_depth", 0))
        if nd0 > 0:
            ctx["_gc_merge_barrier"] = {}
        skip_run_execution = False
        if nd0 == 0:
            if self._run_id is None:
                ctx.setdefault("run_id", str(uuid.uuid4()))
            cand = self._run_id if self._run_id is not None else ctx.get("run_id")
            norm = normalize_run_id_candidate(cand)
            if norm is None:
                norm = str(uuid.uuid4())
            self._run_id = norm
            ctx["run_id"] = norm
        elif self._run_id is None:
            n = normalize_run_id_candidate(ctx.get("run_id"))
            if n:
                self._run_id = n
        if nd0 == 0 and self._run_id:
            started_at = datetime.now(UTC).isoformat()
            ctx["_gc_started_at_iso"] = started_at
            if not ctx.get("root_run_artifact_dir"):
                ab0 = self._host.artifacts_base
                if ab0 is not None:
                    from graph_caster.artifacts import create_root_run_artifact_dir

                    run_dir0 = create_root_run_artifact_dir(ab0, self._doc.graph_id)
                    path_str0 = str(run_dir0)
                    ctx["root_run_artifact_dir"] = path_str0
                    ctx.setdefault("_gc_artifacts_base_resolved", str(Path(ab0).resolve()))
                    if self._persist_run_events:
                        log_path = run_dir0 / "events.ndjson"
                        file_sink = NdjsonAppendFileSink(log_path)
                        self._persist_file_sink = file_sink
                        self._event_sink = TeeRunEventSink(self._event_sink, file_sink)
                    self.emit("run_root_ready", rootGraphId=self._doc.graph_id, rootRunArtifactDir=path_str0)
            started_payload: dict[str, Any] = {
                "rootGraphId": self._doc.graph_id,
                "startedAt": started_at,
                "mode": run_mode_wire(ctx),
            }
            if self._doc.title:
                started_payload["graphTitle"] = self._doc.title
            from graph_caster.runtime_validate import first_runtime_node_blocker

            blocker = first_runtime_node_blocker(self._doc)
            if blocker is not None:
                code, nid, detail = blocker
                err_ev: dict[str, Any] = {"message": detail, "gcCode": code.value}
                if nid:
                    err_ev["nodeId"] = nid
                self.emit("error", **err_ev)
                ctx["_run_success"] = False
                skip_run_execution = True
            if self._session_registry is not None:
                reaped = self._session_registry.reap_stale_running_sessions()
                if reaped:
                    _LOG.debug("reaped stale run sessions: %s", ",".join(reaped))
                if not skip_run_execution:
                    sess = RunSession(run_id=self._run_id, root_graph_id=self._doc.graph_id)
                    self._session_registry.register(sess)
                    ctx["_gc_run_session"] = sess
            if not skip_run_execution:
                self.emit("run_started", **started_payload)
        from graph_caster import otel_tracing
        import contextlib
        otel_tracing.configure_otel()
        _otel_tracer = otel_tracing.get_tracer()
        _otel_root_cm = (
            _otel_tracer.start_as_current_span(
                "gc.run",
                attributes=otel_tracing.root_run_attributes(
                    run_id=str(ctx.get("run_id") or ""),
                    graph_id=self._doc.graph_id,
                    nesting_depth=nd0,
                ),
            )
            if nd0 == 0
            else contextlib.nullcontext()
        )
        with _otel_root_cm as _otel_root_span:
            try:
                if not skip_run_execution:
                    self._run_from_execution_phase(start_node_id, ctx, nd0, _otel_tracer)
            finally:
                self._run_from_root_finally(ctx, nd0, _otel_root_span)

    def _merge_run_variables_from_node_output(self, ctx: dict[str, Any], node_id: str) -> None:
        outs = ctx.get("node_outputs")
        if not isinstance(outs, dict):
            return
        raw = outs.get(node_id)
        if not isinstance(raw, dict):
            return
        remove = raw.get("runVariablesRemove")
        if remove is None:
            remove = raw.get("run_variables_remove")
        if isinstance(remove, list):
            pool0 = ctx.setdefault("run_variables", {})
            if not isinstance(pool0, dict):
                pool0 = {}
                ctx["run_variables"] = pool0
            for k in remove:
                if isinstance(k, str) and k:
                    pool0.pop(k, None)
        rv = raw.get("runVariables")
        if rv is None:
            rv = raw.get("run_variables")
        if isinstance(rv, dict) and rv:
            pool = ctx.setdefault("run_variables", {})
            if not isinstance(pool, dict):
                pool = {}
                ctx["run_variables"] = pool
            pool.update(rv)

    def _execute_graph_ref(self, node: Node, ctx: dict[str, Any]) -> bool:
        from graph_caster.validate import GraphStructureError, validate_graph_structure
        from graph_caster.workspace import WorkspaceIndexError, resolve_graph_path

        root = self._host.graphs_root
        if root is None:
            self.emit("error", nodeId=node.id, message="graph_ref_requires_graphs_directory")
            return False

        target_id = node.data.get("targetGraphId") or node.data.get("graphId")
        if not target_id:
            self.emit("error", nodeId=node.id, message="graph_ref_missing_targetGraphId")
            return False
        target_id = str(target_id)

        try:
            path = resolve_graph_path(root, target_id)
        except WorkspaceIndexError as e:
            self.emit("error", nodeId=node.id, message=str(e))
            return False

        if path is None:
            self.emit("error", nodeId=node.id, message=f"unknown targetGraphId {target_id!r}")
            return False

        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            self.emit("error", nodeId=node.id, message=f"cannot load nested graph: {e}")
            return False

        try:
            nested = GraphDocument.from_dict(raw)
        except ValueError as e:
            self.emit("error", nodeId=node.id, message=f"nested graph invalid document: {e}")
            return False
        try:
            validate_graph_structure(nested)
        except GraphStructureError as e:
            self.emit("error", nodeId=node.id, message=f"nested graph invalid: {e}")
            return False

        ndepth = int(ctx.get("nesting_depth", 0))
        maxd = int(ctx.get("max_nesting_depth", 16))
        if ndepth >= maxd:
            self.emit("error", nodeId=node.id, message="max_nesting_depth_exceeded")
            return False

        nested_rev = graph_document_revision(nested)
        # Keys are target graph ids (workspace: one file per graphId). Same id → same path.
        rev_bucket = ctx.setdefault("_gc_nested_doc_revisions", {})
        rev_bucket[target_id] = nested_rev

        depth_next = ndepth + 1
        nested_payload: dict[str, Any] = {
            "parentNodeId": node.id,
            "targetGraphId": target_id,
            "depth": depth_next,
            "path": str(path),
        }
        rrd = ctx.get("root_run_artifact_dir")
        if rrd:
            nested_payload["rootRunArtifactDir"] = str(rrd)
        self.emit("nested_graph_enter", **nested_payload)

        child_ctx = dict(ctx)
        child_ctx["nesting_depth"] = depth_next
        child_ctx["_parent_graph_ref_node_id"] = node.id
        child_ctx["_gc_nested_doc_revisions"] = dict(rev_bucket)

        sess = child_ctx.get("_gc_run_session")
        sess_coop = sess if isinstance(sess, RunSession) else None
        if graph_ref_subprocess_enabled():
            run_nested_graph_ref_subprocess(
                nested_path=path,
                child_ctx=child_ctx,
                sink=self._event_sink,
                host=self._host,
                run_id=self._run_id,
                step_cache=self._step_cache,
                run_session=sess_coop,
            )
        else:
            child = GraphRunner(
                nested,
                self._event_sink,
                host=self._host,
                run_id=self._run_id,
                session_registry=self._session_registry,
                stop_after_node_id=None,
                step_cache=self._step_cache,
                persist_run_events=False,
            )
            child.run(context=child_ctx)

        self.emit(
            "nested_graph_exit",
            parentNodeId=node.id,
            targetGraphId=target_id,
            depth=depth_next,
        )
        nested_ok = bool(child_ctx.get("_run_success", False))
        if child_ctx.get("_run_cancelled"):
            ctx["_run_cancelled"] = True
        ctx["last_result"] = nested_ok
        if not nested_ok:
            self.emit(
                "error",
                nodeId=node.id,
                message="nested_graph_run_incomplete",
                targetGraphId=target_id,
            )
            return False
        return True
