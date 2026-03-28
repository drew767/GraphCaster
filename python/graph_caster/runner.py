# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import copy
import json
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from graph_caster.document_revision import graph_document_revision
from graph_caster.edge_conditions import eval_edge_condition
from graph_caster.host_context import RunHostContext
from graph_caster.models import Edge, GraphDocument, Node
from graph_caster.nested_run_subprocess import graph_ref_subprocess_enabled, run_nested_graph_ref_subprocess
from graph_caster.node_output_cache import (
    StepCachePolicy,
    StepCacheStore,
    compute_step_cache_key,
    step_cache_root,
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
    gc_pin_valid_for_short_circuit,
    last_result_from_process_result,
    merged_process_result_for_pin_short_circuit,
    snapshot_for_pin_event,
)
from graph_caster.mcp_client import (
    format_mcp_result_preview,
    redact_mcp_tool_arguments_for_event,
    redact_mcp_tool_data_for_execute,
    run_mcp_tool_call,
)
from graph_caster.process_exec import redact_task_data_for_node_execute, task_declares_env_keys
from graph_caster.validate import (
    find_ai_route_structure_warnings,
    find_barrier_merge_out_error_incoming,
    find_fork_few_outputs_warnings,
    find_mcp_tool_structure_warnings,
    merge_mode,
)

EventSink = Callable[[RunEventDict], None] | RunEventSink

BRANCH_SKIP_REASON_CONDITION_FALSE = "condition_false"
BRANCH_SKIP_REASON_AI_ROUTE_NOT_SELECTED = "ai_route_not_selected"

EDGE_SOURCE_OUT_ERROR = "out_error"


def _fork_unconditional_edges(doc: GraphDocument, fork_id: str, by_id: dict[str, Node]) -> list[Edge]:
    out: list[Edge] = []
    for e in doc.edges:
        if e.source != fork_id or e.source_handle == EDGE_SOURCE_OUT_ERROR:
            continue
        tgt = by_id.get(e.target)
        if tgt is None or tgt.type == "comment":
            continue
        c = e.condition
        if c is not None and str(c).strip() != "":
            continue
        out.append(e)
    return out


def _edges_from_source(node_id: str, doc: GraphDocument, *, error_route: bool) -> list[Edge]:
    out: list[Edge] = []
    for e in doc.edges:
        if e.source != node_id:
            continue
        is_err = e.source_handle == EDGE_SOURCE_OUT_ERROR
        if error_route:
            if is_err:
                out.append(e)
        else:
            if not is_err:
                out.append(e)
    return out


def _evaluate_next_edge(edges: list[Edge], context: dict[str, Any]) -> tuple[Edge | None, list[Edge]]:
    skipped: list[Edge] = []
    if not edges:
        return None, skipped
    for e in edges:
        if e.condition is None or e.condition.strip() == "":
            return e, skipped
        if eval_edge_condition(e.condition, context):
            return e, skipped
        skipped.append(e)
    return None, skipped


def _task_has_process_command(node: Node) -> bool:
    d = node.data
    if d.get("command") is not None or d.get("argv") is not None:
        return True
    # Key present (even {} or invalid value): run process_exec so validation / spawn_error surfaces.
    return "gcCursorAgent" in d


def _node_wants_step_cache(node: Node) -> bool:
    v = node.data.get("stepCache")
    if v is True:
        return True
    if v in (1, "1", "true", "True", "yes", "Yes"):
        return True
    return False


def _cache_key_prefix(key_hex: str) -> str:
    if len(key_hex) >= 16:
        return key_hex[:16]
    return key_hex


_RUN_MODE_MAX_LEN = 128


def _normalize_run_id_candidate(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        t = value.strip()
        return t if t else None
    s = str(value).strip()
    return s if s else None


def _run_mode_wire(ctx: dict[str, Any]) -> str:
    rm = ctx.get("run_mode", "manual")
    if isinstance(rm, str):
        s = rm.strip()
        out = s if s else "manual"
    elif rm is None:
        out = "manual"
    else:
        out = str(rm).strip() or "manual"
    if len(out) > _RUN_MODE_MAX_LEN:
        return out[:_RUN_MODE_MAX_LEN]
    return out


def _prepare_context(ctx: dict[str, Any] | None) -> dict[str, Any]:
    c: dict[str, Any] = {} if ctx is None else ctx
    c.pop("graphs_root", None)
    c.pop("artifacts_base", None)
    c.pop("_gc_process_cancelled", None)
    c.pop("_run_cancelled", None)
    c.setdefault("nesting_depth", 0)
    c.setdefault("node_outputs", {})
    c.setdefault("max_nesting_depth", 16)
    c.setdefault("last_result", True)
    return c


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

    def emit(self, event_type: str, **payload: Any) -> None:
        ev: RunEventDict = {"type": event_type, **payload}
        rid = self._run_id
        if rid:
            ev["runId"] = rid
        self._event_sink.emit(ev)

    def _merge_barrier_state(self, ctx: dict[str, Any]) -> dict[str, Any]:
        return ctx.setdefault("_gc_merge_barrier", {})

    def _barrier_required_sources(self, merge_id: str) -> frozenset[str]:
        req: set[str] = set()
        for e in self._doc.edges:
            if e.target != merge_id or e.source_handle == EDGE_SOURCE_OUT_ERROR:
                continue
            src = self._node_by_id.get(e.source)
            if src is None or src.type == "comment":
                continue
            req.add(e.source)
        return frozenset(req)

    def _merge_barrier_arrive(self, merge_id: str, from_source_id: str, ctx: dict[str, Any], step_q: StepQueue) -> None:
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
            step_q.append(ExecutionFrame(edge.target))
            return
        tgt_node = self._node_by_id.get(edge.target)
        if tgt_node is not None and tgt_node.type == "merge" and merge_mode(tgt_node) == "barrier":
            self._merge_barrier_arrive(edge.target, from_node_id, ctx, step_q)
            return
        step_q.append(ExecutionFrame(edge.target))

    def _enqueue_fork_branches(self, fork_id: str, ctx: dict[str, Any], step_q: StepQueue) -> bool:
        edges = _fork_unconditional_edges(self._doc, fork_id, self._node_by_id)
        if not edges:
            self.emit("run_end", reason="fork_no_unconditional_outgoing")
            return False
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
        req_bytes = 0
        preds = self._incoming_success_sources(node.id)
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
        prov = ctx.get("ai_route_provider")
        override = prov if callable(prov) else None
        outcome = resolve_ai_route_choice(
            doc=self._doc,
            node=node,
            ctx=ctx,
            run_id=rid,
            preds=preds,
            provider_override=override,
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
        outs_map = ctx.setdefault("node_outputs", {})
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

        if not tool_name:
            self.emit(
                "mcp_tool_failed",
                nodeId=node.id,
                graphId=self._doc.graph_id,
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

        inv_args = redact_mcp_tool_arguments_for_event(arguments)
        self.emit(
            "mcp_tool_invoke",
            nodeId=node.id,
            graphId=self._doc.graph_id,
            toolName=tool_name,
            transport=transport,
            arguments=inv_args,
        )

        prov = ctx.get("mcp_tool_provider")
        override = prov if callable(prov) else None
        outcome = run_mcp_tool_call(
            data=d,
            ctx=ctx,
            graph_id=self._doc.graph_id,
            node_id=node.id,
            workspace_secrets=self._get_workspace_secrets(),
            tool_name=tool_name,
            arguments=arguments,
            timeout_sec=to,
            provider=override,
        )

        if outcome.ok:
            self.emit(
                "mcp_tool_result",
                nodeId=node.id,
                graphId=self._doc.graph_id,
                toolName=tool_name,
                transport=transport,
                resultPreview=format_mcp_result_preview(outcome.result),
            )
            outs_map[node.id]["mcpTool"] = {"success": True, "result": outcome.result}
            ctx["last_result"] = True
            return True

        self.emit(
            "mcp_tool_failed",
            nodeId=node.id,
            graphId=self._doc.graph_id,
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

    def _follow_edges_from(
        self,
        node_id: str,
        ctx: dict[str, Any],
        *,
        error_route: bool,
        step_q: StepQueue,
    ) -> bool:
        outs = _edges_from_source(node_id, self._doc, error_route=error_route)
        chosen, skipped_edges = _evaluate_next_edge(outs, ctx)
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

    def run(self, context: dict[str, Any] | None = None, start_node_id: str | None = None) -> None:
        from graph_caster.validate import validate_graph_structure

        ctx = _prepare_context(context)
        if start_node_id is not None:
            entry = start_node_id
        else:
            entry = validate_graph_structure(self._doc)
        self.run_from(entry, ctx)

    def run_from(self, start_node_id: str, context: dict[str, Any] | None = None) -> None:
        ctx = _prepare_context(context)
        gr = self._host.graphs_root
        if gr is not None:
            ctx["_gc_graphs_root"] = str(gr.resolve())
        apply_gc_pins_to_document_context(self._doc, ctx)
        ctx["_run_success"] = False
        ctx.pop("_run_partial_stop", None)
        nd0 = int(ctx.get("nesting_depth", 0))
        if nd0 > 0:
            ctx["_gc_merge_barrier"] = {}
        if nd0 == 0:
            if self._run_id is None:
                ctx.setdefault("run_id", str(uuid.uuid4()))
            cand = self._run_id if self._run_id is not None else ctx.get("run_id")
            norm = _normalize_run_id_candidate(cand)
            if norm is None:
                norm = str(uuid.uuid4())
            self._run_id = norm
            ctx["run_id"] = norm
        elif self._run_id is None:
            n = _normalize_run_id_candidate(ctx.get("run_id"))
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
                    if self._persist_run_events:
                        log_path = run_dir0 / "events.ndjson"
                        file_sink = NdjsonAppendFileSink(log_path)
                        self._persist_file_sink = file_sink
                        self._event_sink = TeeRunEventSink(self._event_sink, file_sink)
                    self.emit("run_root_ready", rootGraphId=self._doc.graph_id, rootRunArtifactDir=path_str0)
            started_payload: dict[str, Any] = {
                "rootGraphId": self._doc.graph_id,
                "startedAt": started_at,
                "mode": _run_mode_wire(ctx),
            }
            if self._doc.title:
                started_payload["graphTitle"] = self._doc.title
            if self._session_registry is not None:
                sess = RunSession(run_id=self._run_id, root_graph_id=self._doc.graph_id)
                self._session_registry.register(sess)
                ctx["_gc_run_session"] = sess
            self.emit("run_started", **started_payload)
        try:
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

                self.emit("node_enter", nodeId=node.id, nodeType=node.type, graphId=self._doc.graph_id)
                if node.type == "task":
                    red_task = redact_task_data_for_node_execute(node.data)
                    exec_data = red_task
                    stored_node_data = dict(node.data) if red_task is node.data else red_task
                elif node.type == "mcp_tool":
                    red_m = redact_mcp_tool_data_for_execute(node.data)
                    exec_data = red_m
                    stored_node_data = dict(node.data) if red_m is node.data else red_m
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
                        st = (ctx.get("_gc_merge_barrier") or {}).get(node.id, {})
                        arrived = st.get("arrived") or set()
                        outs_map[node.id]["merge"] = {
                            "passthrough": False,
                            "barrier": True,
                            "arrivedFrom": sorted(arrived),
                        }
                    else:
                        outs_map[node.id]["merge"] = {"passthrough": True}

                if node.type == "comment":
                    pass
                elif node.type == "graph_ref":
                    ok = self._execute_graph_ref(node, ctx)
                    if not ok:
                        self.emit("node_exit", nodeId=node.id, nodeType=node.type, graphId=self._doc.graph_id)
                        if not ctx.get("_run_cancelled"):
                            ctx["last_result"] = False
                            if self._follow_edges_from(node.id, ctx, error_route=True, step_q=step_q):
                                continue
                        break
                elif node.type == "mcp_tool":
                    ok = self._execute_mcp_tool(node, ctx)
                    if not ok:
                        self.emit("node_exit", nodeId=node.id, nodeType=node.type, graphId=self._doc.graph_id)
                        if not ctx.get("_run_cancelled"):
                            ctx["last_result"] = False
                            if self._follow_edges_from(node.id, ctx, error_route=True, step_q=step_q):
                                continue
                        break
                elif node.type == "task" and _task_has_process_command(node):
                    from graph_caster.process_exec import run_task_process

                    sess = ctx.get("_gc_run_session")

                    def _should_cancel() -> bool:
                        return sess is not None and sess.cancel_event.is_set()

                    pr_pin = merged_process_result_for_pin_short_circuit(outs_map.get(node.id))
                    pin_short = gc_pin_valid_for_short_circuit(node) and pr_pin is not None
                    if pin_short:
                        task_exit_used_pin = True
                        ctx["last_result"] = last_result_from_process_result(pr_pin)
                        self.emit(
                            "node_pinned_skip",
                            nodeId=node.id,
                            graphId=self._doc.graph_id,
                        )
                        ok = ctx["last_result"]
                    else:
                        ok = True

                    used_step_cache = False
                    cache_key: str | None = None
                    pol = self._step_cache
                    store = self._ensure_step_cache_store()
                    want_cache = _node_wants_step_cache(node)
                    cache_active = (
                        not pin_short
                        and want_cache
                        and pol is not None
                        and pol.enabled
                        and store is not None
                    )
                    gid = self._doc.graph_id
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
                        self._step_cache_workspace_secrets_fp(node.data) if cache_active else None
                    )

                    if not pin_short and cache_active:
                        up, inc_reason = self._upstream_outputs_for_step_cache(node.id, ctx)
                        if inc_reason:
                            upstream_incomplete = True
                            self.emit(
                                "node_cache_miss",
                                nodeId=node.id,
                                graphId=gid,
                                reason=inc_reason,
                            )
                        elif dirty:
                            cache_key = compute_step_cache_key(
                                graph_rev=graph_rev,
                                graph_id=gid,
                                node_id=node.id,
                                node_data=node.data,
                                upstream_outputs=up,
                                tenant_id=tenant_s,
                                workspace_secrets_file_fp=cache_ws_fp,
                            )
                            self.emit(
                                "node_cache_miss",
                                nodeId=node.id,
                                graphId=gid,
                                keyPrefix=_cache_key_prefix(cache_key),
                                reason="dirty",
                            )
                        else:
                            cache_key = compute_step_cache_key(
                                graph_rev=graph_rev,
                                graph_id=gid,
                                node_id=node.id,
                                node_data=node.data,
                                upstream_outputs=up,
                                tenant_id=tenant_s,
                                workspace_secrets_file_fp=cache_ws_fp,
                            )
                            cached = store.get(cache_key)
                            if cached is not None:
                                outs_map[node.id] = copy.deepcopy(cached)
                                pr = cached.get("processResult")
                                ctx["last_result"] = last_result_from_process_result(pr)
                                self.emit(
                                    "node_cache_hit",
                                    nodeId=node.id,
                                    graphId=gid,
                                    keyPrefix=_cache_key_prefix(cache_key),
                                )
                                used_step_cache = True
                            else:
                                self.emit(
                                    "node_cache_miss",
                                    nodeId=node.id,
                                    graphId=gid,
                                    keyPrefix=_cache_key_prefix(cache_key),
                                )

                    if not pin_short:
                        if not used_step_cache:
                            ok = run_task_process(
                                node_id=node.id,
                                graph_id=self._doc.graph_id,
                                data=dict(node.data),
                                ctx=ctx,
                                emit=self.emit,
                                should_cancel=_should_cancel if sess is not None else None,
                                workspace_secrets=self._get_workspace_secrets(),
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
                        if isinstance(snap_o, dict) and isinstance(
                            snap_o.get("processResult"), dict
                        ):
                            self.emit(
                                "node_outputs_snapshot",
                                nodeId=node.id,
                                graphId=self._doc.graph_id,
                                snapshot=snapshot_for_pin_event(snap_o),
                            )

                    if not ok:
                        if ctx.get("_gc_process_cancelled"):
                            ctx["_run_cancelled"] = True
                        ne_task: dict[str, Any] = {
                            "nodeId": node.id,
                            "nodeType": node.type,
                            "graphId": self._doc.graph_id,
                        }
                        if task_exit_used_pin:
                            ne_task["usedPin"] = True
                        self.emit("node_exit", **ne_task)
                        if ctx.get("_gc_process_cancelled"):
                            break
                        ctx["last_result"] = False
                        if self._follow_edges_from(node.id, ctx, error_route=True, step_q=step_q):
                            continue
                        break

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
                        break
                    continue
                if node.type == "ai_route":
                    ctx["last_result"] = True
                    ok_ai = self._follow_ai_route_from(node, ctx, step_q)
                    self.emit("node_exit", **ne)
                    if not ok_ai:
                        break
                    continue
                if not self._follow_edges_from(node.id, ctx, error_route=False, step_q=step_q):
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
        finally:
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
                try:
                    if self._persist_run_events:
                        rrd = ctx.get("root_run_artifact_dir")
                        if rrd:
                            from graph_caster.artifacts import write_run_summary

                            write_run_summary(
                                Path(str(rrd)),
                                {
                                    "schemaVersion": 1,
                                    "runId": self._run_id,
                                    "rootGraphId": self._doc.graph_id,
                                    "status": st,
                                    "startedAt": ctx.get("_gc_started_at_iso"),
                                    "finishedAt": finished_at,
                                },
                            )
                finally:
                    if self._persist_file_sink is not None:
                        self._persist_file_sink.close()
                        self._persist_file_sink = None
                    if self._session_registry is not None:
                        self._session_registry.complete(self._run_id, st)

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
