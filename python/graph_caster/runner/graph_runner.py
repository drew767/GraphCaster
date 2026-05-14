# Copyright GraphCaster. All Rights Reserved.

"""Entry-point class for executing a :class:`GraphDocument`.

The orchestration is split across sibling modules:

* :mod:`graph_caster.runner.event_emitter` — thread-safe event sink wrapper.
* :mod:`graph_caster.runner.secrets_resolver` — workspace secret loading.
* :mod:`graph_caster.runner.run_state_machine` — lifecycle (``run``/``run_from``)
  and the inner dispatch loop.
* :mod:`graph_caster.runner.visit_dispatch` — per-node-type visit routing
  and fork-parallel worker.

This file binds those together and preserves the historical public class API:
callers create ``GraphRunner(document, sink=..., ...)`` and call ``run``,
``run_from``, ``emit``, ``emit_node_outputs_snapshot``. Private attributes
(``_doc``, ``_node_by_id``, ``_event_sink``, ``_state_lock``, ``_emit_lock``,
``_run_id``, ``_host``, ``_step_cache``, …) are still attached to instances
because some tests reach into them directly.
"""

from __future__ import annotations

import logging
import os
import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Literal

from graph_caster.execution.execution_coordinator import ExecutionCoordinator
from graph_caster.fork_parallel import EDGE_SOURCE_OUT_ERROR, ForkBranchPlan, build_fork_parallel_plans
from graph_caster.host_context import RunHostContext
from graph_caster.models import Edge, GraphDocument, Node, is_editor_frame_node_type
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
from graph_caster.runner.edge_routing import edges_from_source, evaluate_next_edge, fork_unconditional_edges
from graph_caster.runner.event_emitter import RunEventEmitter
from graph_caster.runner.node_visits import execute_mcp_tool_node
from graph_caster.runner.run_helpers import (
    agent_has_executable_config,
    cache_key_prefix,
    debounce_has_duration,
    delay_has_duration,
    http_request_has_url,
    llm_agent_has_executable_command,
    node_wants_step_cache,
    python_code_has_code,
    rag_index_has_valid_config,
    rag_query_has_url_and_query,
    set_variable_has_valid_config,
    task_has_process_command,
    wait_for_has_executable_config,
)
from graph_caster.runner import run_state_machine
from graph_caster.runner.secrets_resolver import WorkspaceSecretsResolver
from graph_caster.runner.step_cache_lookup import plan_step_cache_key
from graph_caster.runner.visit_dispatch import (
    VISIT_FN_BY_NODE_TYPE,
    fork_parallel_branch_worker,
    fork_worker_begin_task_visit,
)
from graph_caster.validate import merge_mode

EventSink = Callable[[RunEventDict], None] | RunEventSink

BRANCH_SKIP_REASON_CONDITION_FALSE = "condition_false"
BRANCH_SKIP_REASON_AI_ROUTE_NOT_SELECTED = "ai_route_not_selected"

_LOG = logging.getLogger(__name__)


class GraphRunner:
    """Execute a :class:`GraphDocument` and emit run events.

    Public surface preserved verbatim — see module docstring for the
    decomposition. Private attributes are still exposed on the instance for
    backwards-compatible test access.
    """

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
        public_stream: bool = False,
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
        self._emitter = RunEventEmitter(self._event_sink, graph_id=document.graph_id, run_id=run_id)
        self._emit_lock = self._emitter.lock
        self._secrets = WorkspaceSecretsResolver(self._host.resolved_workspace_root)
        self._state_lock = threading.RLock()
        if fork_max_parallel is not None:
            self._fork_max_parallel_cap = max(1, int(fork_max_parallel))
        else:
            raw = (os.environ.get("GC_FORK_MAX_PARALLEL") or "").strip()
            self._fork_max_parallel_cap = max(1, int(raw)) if raw.isdigit() else 1
        self._public_stream = bool(public_stream)
        self._execution_coordinator = ExecutionCoordinator()

    def __setattr__(self, name: str, value: Any) -> None:
        # Keep RunEventEmitter in sync when callers mutate the legacy private
        # attributes (run_state_machine swaps in a TeeRunEventSink + sets run_id).
        super().__setattr__(name, value)
        if name == "_run_id":
            emitter = self.__dict__.get("_emitter")
            if emitter is not None:
                emitter.set_run_id(value)
        elif name == "_event_sink":
            emitter = self.__dict__.get("_emitter")
            if emitter is not None:
                emitter.replace_sink(value)

    # ----- secrets resolution (delegated to WorkspaceSecretsResolver) -----

    def _ensure_secrets_provider(self):
        return self._secrets.ensure_provider()

    def _get_workspace_secrets(self) -> dict[str, str]:
        return self._secrets.get_mapping()

    def _get_secrets_file_fingerprint(self) -> str:
        return self._secrets.get_fingerprint()

    def _step_cache_workspace_secrets_fp(self, node_data: dict[str, Any]) -> str | None:
        return self._secrets.step_cache_fingerprint_for_node(node_data)

    # ----- step cache -----

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

    # ----- graph topology helpers -----

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

    # ----- event emission (delegated to RunEventEmitter) -----

    def emit(self, event_type: str, **payload: Any) -> None:
        self._emitter.emit(event_type, **payload)

    def emit_node_outputs_snapshot(
        self, ctx: dict[str, Any], node_id: str, outs_slice: dict[str, Any]
    ) -> None:
        self._emitter.emit_node_outputs_snapshot(ctx, node_id, outs_slice)

    # ----- merge-barrier accounting -----

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

    # ----- edge traversal -----

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

    # ----- fork-parallel scheduling -----

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
            if n.type == "agent" and agent_has_executable_config(n):
                continue
            if n.type == "http_request" and http_request_has_url(n):
                continue
            if n.type == "rag_query" and rag_query_has_url_and_query(n):
                continue
            if n.type == "rag_index" and rag_index_has_valid_config(n):
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
        fork_worker_begin_task_visit(self, node, ctx)

    # ----- per-node-type visit shims -----

    def _run_subprocess_task_visit(
        self,
        node: Node,
        ctx: dict[str, Any],
        step_q: StepQueue,
        *,
        fork_parallel_worker: bool = False,
    ) -> tuple[Literal["ok", "continue", "break"], bool]:
        return VISIT_FN_BY_NODE_TYPE["task"](
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
        return VISIT_FN_BY_NODE_TYPE["llm_agent"](
            self, node, ctx, step_q, fork_parallel_worker=fork_parallel_worker
        )

    def _run_agent_visit(
        self,
        node: Node,
        ctx: dict[str, Any],
        step_q: StepQueue,
        *,
        fork_parallel_worker: bool = False,
    ) -> tuple[Literal["ok", "continue", "break"], bool]:
        return VISIT_FN_BY_NODE_TYPE["agent"](
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
        return VISIT_FN_BY_NODE_TYPE["http_request"](
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
        return VISIT_FN_BY_NODE_TYPE["rag_query"](
            self, node, ctx, step_q, fork_parallel_worker=fork_parallel_worker
        )

    def _run_rag_index_visit(
        self,
        node: Node,
        ctx: dict[str, Any],
        step_q: StepQueue,
        *,
        fork_parallel_worker: bool = False,
    ) -> tuple[Literal["ok", "continue", "break"], bool]:
        return VISIT_FN_BY_NODE_TYPE["rag_index"](
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
        return VISIT_FN_BY_NODE_TYPE["python_code"](
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
        return VISIT_FN_BY_NODE_TYPE["set_variable"](
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
        return VISIT_FN_BY_NODE_TYPE["delay"](
            self, node, ctx, step_q, fork_parallel_worker=fork_parallel_worker
        )

    def _run_debounce_visit(
        self,
        node: Node,
        ctx: dict[str, Any],
        step_q: StepQueue,
        *,
        fork_parallel_worker: bool = False,
    ) -> tuple[Literal["ok", "continue", "break"], bool]:
        return VISIT_FN_BY_NODE_TYPE["debounce"](
            self, node, ctx, step_q, fork_parallel_worker=fork_parallel_worker
        )

    def _run_wait_for_visit(
        self,
        node: Node,
        ctx: dict[str, Any],
        step_q: StepQueue,
        *,
        fork_parallel_worker: bool = False,
    ) -> tuple[Literal["ok", "continue", "break"], bool]:
        return VISIT_FN_BY_NODE_TYPE["wait_for"](
            self, node, ctx, step_q, fork_parallel_worker=fork_parallel_worker
        )

    def _run_trigger_webhook_visit(
        self,
        node: Node,
        ctx: dict[str, Any],
        step_q: StepQueue,
        *,
        fork_parallel_worker: bool = False,
    ) -> tuple[Literal["ok", "continue", "break"], bool]:
        return VISIT_FN_BY_NODE_TYPE["trigger_webhook"](
            self, node, ctx, step_q, fork_parallel_worker=fork_parallel_worker
        )

    def _run_trigger_schedule_visit(
        self,
        node: Node,
        ctx: dict[str, Any],
        step_q: StepQueue,
        *,
        fork_parallel_worker: bool = False,
    ) -> tuple[Literal["ok", "continue", "break"], bool]:
        return VISIT_FN_BY_NODE_TYPE["trigger_schedule"](
            self, node, ctx, step_q, fork_parallel_worker=fork_parallel_worker
        )

    def _fork_parallel_branch_worker(
        self, plan: ForkBranchPlan, ctx: dict[str, Any], step_q: StepQueue
    ) -> None:
        fork_parallel_branch_worker(self, plan, ctx, step_q)

    def _run_fork_parallel_branches(
        self,
        fork_id: str,
        plans: list[ForkBranchPlan],
        ctx: dict[str, Any],
        step_q: StepQueue,
        max_workers: int,
    ) -> None:
        self._emit_fork_parallel_frontier_events(fork_id, plans)
        n_workers = self._execution_coordinator.fork_threadpool_workers(len(plans), max_workers)
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

    # ----- AI-route dispatch -----

    def _follow_ai_route_from(self, node: Node, ctx: dict[str, Any], step_q: StepQueue) -> bool:
        import copy

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
            detail_emit = outcome.error_detail
            if isinstance(detail_emit, str) and len(detail_emit) > 512:
                detail_emit = detail_emit[:509] + "..."
            self.emit(
                "ai_route_failed",
                nodeId=node.id,
                graphId=gid,
                reason=outcome.error_reason,
                detail=detail_emit,
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

    # ----- MCP tool / graph_ref -----

    def _execute_mcp_tool(self, node: Node, ctx: dict[str, Any]) -> bool:
        return execute_mcp_tool_node(self, node, ctx)

    def _execute_graph_ref(self, node: Node, ctx: dict[str, Any]) -> bool:
        return run_state_machine.execute_graph_ref(self, node, ctx)

    # ----- linear edge follow -----

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

    # ----- run lifecycle (delegated to run_state_machine) -----

    def _run_from_execution_phase(
        self, start_node_id: str, ctx: dict[str, Any], nd0: int, otel_tracer: Any
    ) -> None:
        run_state_machine.run_from_execution_phase(self, start_node_id, ctx, nd0, otel_tracer)

    def _run_from_root_finally(self, ctx: dict[str, Any], nd0: int, root_span: Any) -> None:
        run_state_machine.run_from_root_finally(self, ctx, nd0, root_span)

    def _merge_run_variables_from_node_output(self, ctx: dict[str, Any], node_id: str) -> None:
        run_state_machine.merge_run_variables_from_node_output(ctx, node_id)

    def run(self, context: dict[str, Any] | None = None, start_node_id: str | None = None) -> None:
        run_state_machine.run(self, context, start_node_id)

    def run_from(self, start_node_id: str, context: dict[str, Any] | None = None) -> None:
        run_state_machine.run_from(self, start_node_id, context)
