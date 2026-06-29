# Copyright GraphCaster. All Rights Reserved.

"""Run lifecycle for :class:`GraphRunner`.

This module owns the *outer* lifecycle:

* ``run`` / ``run_from`` — entry points (validate, resolve start node, set up
  context, run id, root artifacts, session registry, OTel root span).
* ``run_from_execution_phase`` — the dispatch loop that pops :class:`ExecutionFrame`
  off the :class:`StepQueue` and routes each node to the right ``run_*_visit``
  helper. Pause/resume/cancel checks live here.
* ``run_from_root_finally`` — terminal accounting for the root run: status,
  ``run_finished`` event, webhook + audit + plugin hooks, persistent sink
  cleanup, OTel root-span finalisation.

The body is plain functions taking a ``runner`` argument so we don't double
the surface; :class:`GraphRunner` keeps the same public methods and simply
delegates to these helpers.
"""

from __future__ import annotations

import contextlib
import copy
import json
import logging
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from graph_caster.document_revision import graph_document_revision
from graph_caster.gc_pin import apply_gc_pins_to_document_context, find_gc_pin_empty_payload_warnings
from graph_caster.models import GraphDocument, Node, is_editor_frame_node_type
from graph_caster.nested_run_subprocess import graph_ref_subprocess_enabled, run_nested_graph_ref_subprocess
from graph_caster.port_data_kinds import find_port_data_kind_warnings
from graph_caster.run_event_sink import NdjsonAppendFileSink, TeeRunEventSink
from graph_caster.run_sessions import RunSession
from graph_caster.runner.run_helpers import (
    normalize_run_id_candidate,
    prepare_context,
    run_mode_wire,
)
from graph_caster.step_queue import ExecutionFrame, StepQueue
from graph_caster.validate import (
    find_agent_structure_warnings,
    find_ai_route_structure_warnings,
    find_barrier_merge_out_error_incoming,
    find_debounce_structure_warnings,
    find_delay_structure_warnings,
    find_fork_few_outputs_warnings,
    find_http_request_structure_warnings,
    find_llm_agent_structure_warnings,
    find_mcp_tool_structure_warnings,
    find_python_code_structure_warnings,
    find_rag_index_structure_warnings,
    find_rag_query_structure_warnings,
    find_set_variable_structure_warnings,
    find_trigger_schedule_structure_warnings,
    find_trigger_webhook_structure_warnings,
    find_wait_for_structure_warnings,
    merge_mode,
)
from graph_caster.http_request_exec import redact_http_request_data_for_execute
from graph_caster.mcp_client import redact_mcp_tool_data_for_execute
from graph_caster.process_exec import redact_task_data_for_node_execute
from graph_caster.python_code_exec import redact_python_code_data_for_execute
from graph_caster.rag_query_exec import redact_rag_query_data_for_execute
from graph_caster.delay_wait_exec import redact_timer_node_data_for_execute
from graph_caster.runner.node_modes import compute_bypass_passthrough, is_bypass_mode, is_skipped_mode

_LOG = logging.getLogger(__name__)


def run(runner: Any, context: dict[str, Any] | None = None, start_node_id: str | None = None) -> None:
    """Validate the graph (or accept an explicit start), then dispatch ``run_from``."""
    from graph_caster.validate import validate_graph_structure

    ctx = prepare_context(context)
    if start_node_id is not None:
        entry = start_node_id
    else:
        entry = validate_graph_structure(runner._doc)
    runner.run_from(entry, ctx)


def run_from(runner: Any, start_node_id: str, context: dict[str, Any] | None = None) -> None:
    """Set up the run context (run id, artifacts, session, OTel span), then execute."""
    ctx = prepare_context(context)
    gr = runner._host.graphs_root
    if gr is not None:
        ctx["_gc_graphs_root"] = str(gr.resolve())
    apply_gc_pins_to_document_context(runner._doc, ctx)
    pool = ctx.setdefault("run_variables", {})
    if not isinstance(pool, dict):
        pool = {}
        ctx["run_variables"] = pool
    if runner._doc.variables:
        merged = dict(runner._doc.variables)
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
        if runner._run_id is None:
            ctx.setdefault("run_id", str(uuid.uuid4()))
        cand = runner._run_id if runner._run_id is not None else ctx.get("run_id")
        norm = normalize_run_id_candidate(cand)
        if norm is None:
            norm = str(uuid.uuid4())
        runner._run_id = norm
        ctx["run_id"] = norm
    elif runner._run_id is None:
        n = normalize_run_id_candidate(ctx.get("run_id"))
        if n:
            runner._run_id = n
    if nd0 == 0 and runner._run_id:
        started_at = datetime.now(UTC).isoformat()
        ctx["_gc_started_at_iso"] = started_at
        if not ctx.get("root_run_artifact_dir"):
            ab0 = runner._host.artifacts_base
            if ab0 is not None:
                from graph_caster.artifacts import create_root_run_artifact_dir

                run_dir0 = create_root_run_artifact_dir(ab0, runner._doc.graph_id)
                path_str0 = str(run_dir0)
                ctx["root_run_artifact_dir"] = path_str0
                ctx.setdefault("_gc_artifacts_base_resolved", str(Path(ab0).resolve()))
                if runner._persist_run_events:
                    log_path = run_dir0 / "events.ndjson"
                    file_sink = NdjsonAppendFileSink(log_path)
                    runner._persist_file_sink = file_sink
                    runner._event_sink = TeeRunEventSink(runner._event_sink, file_sink)
                runner.emit("run_root_ready", rootGraphId=runner._doc.graph_id, rootRunArtifactDir=path_str0)
        started_payload: dict[str, Any] = {
            "rootGraphId": runner._doc.graph_id,
            "startedAt": started_at,
            "mode": run_mode_wire(ctx),
        }
        if runner._doc.title:
            started_payload["graphTitle"] = runner._doc.title
        from graph_caster.runtime_validate import first_runtime_node_blocker

        blocker = first_runtime_node_blocker(runner._doc)
        if blocker is not None:
            code, nid, detail = blocker
            err_ev: dict[str, Any] = {"message": detail, "gcCode": code.value}
            if nid:
                err_ev["nodeId"] = nid
            runner.emit("error", **err_ev)
            ctx["_run_success"] = False
            skip_run_execution = True
        if runner._session_registry is not None:
            reaped = runner._session_registry.reap_stale_running_sessions()
            if reaped:
                _LOG.debug("reaped stale run sessions: %s", ",".join(reaped))
            if not skip_run_execution:
                sess = RunSession(run_id=runner._run_id, root_graph_id=runner._doc.graph_id)
                runner._session_registry.register(sess)
                ctx["_gc_run_session"] = sess
        if not skip_run_execution:
            runner.emit("run_started", **started_payload)
    from graph_caster import otel_tracing

    otel_tracing.configure_otel()
    _otel_tracer = otel_tracing.get_tracer()
    _otel_root_cm = (
        _otel_tracer.start_as_current_span(
            "gc.run",
            attributes=otel_tracing.root_run_attributes(
                run_id=str(ctx.get("run_id") or ""),
                graph_id=runner._doc.graph_id,
                nesting_depth=nd0,
            ),
        )
        if nd0 == 0
        else contextlib.nullcontext()
    )
    with _otel_root_cm as _otel_root_span:
        try:
            if not skip_run_execution:
                run_from_execution_phase(runner, start_node_id, ctx, nd0, _otel_tracer)
        finally:
            run_from_root_finally(runner, ctx, nd0, _otel_root_span)


def _emit_structure_warnings(runner: Any) -> None:
    """Emit all structure warnings up-front so console output matches the editor."""
    from graph_caster.validate import (
        find_barrier_merge_no_success_incoming_warnings,
        find_merge_incoming_warnings,
    )

    gid = runner._doc.graph_id
    for w in find_merge_incoming_warnings(runner._doc):
        runner.emit(
            "structure_warning",
            kind="merge_few_inputs",
            nodeId=w["nodeId"],
            incomingEdges=w["incomingEdges"],
            graphId=gid,
        )
    for w in find_fork_few_outputs_warnings(runner._doc):
        runner.emit(
            "structure_warning",
            kind="fork_few_outputs",
            nodeId=w["nodeId"],
            unconditionalOutgoing=w["unconditionalOutgoing"],
            graphId=gid,
        )
    for w in find_barrier_merge_out_error_incoming(runner._doc):
        runner.emit(
            "structure_warning",
            kind="barrier_merge_out_error_incoming",
            edgeId=w["edgeId"],
            mergeNodeId=w["mergeNodeId"],
            graphId=gid,
        )
    for w in find_barrier_merge_no_success_incoming_warnings(runner._doc):
        runner.emit(
            "structure_warning",
            kind="barrier_merge_no_success_incoming",
            nodeId=w["nodeId"],
            graphId=gid,
        )
    for w in find_gc_pin_empty_payload_warnings(runner._doc):
        runner.emit(
            "structure_warning",
            kind="gc_pin_enabled_empty_payload",
            nodeId=w["nodeId"],
            graphId=gid,
        )
    for w in find_ai_route_structure_warnings(runner._doc):
        runner.emit("structure_warning", graphId=gid, **w)
    for w in find_mcp_tool_structure_warnings(runner._doc):
        runner.emit("structure_warning", graphId=gid, **w)
    for w in find_http_request_structure_warnings(runner._doc):
        runner.emit("structure_warning", graphId=gid, **w)
    for w in find_rag_query_structure_warnings(runner._doc):
        runner.emit("structure_warning", graphId=gid, **w)
    for w in find_rag_index_structure_warnings(runner._doc):
        runner.emit("structure_warning", graphId=gid, **w)
    for w in find_python_code_structure_warnings(runner._doc):
        runner.emit("structure_warning", graphId=gid, **w)
    for w in find_set_variable_structure_warnings(runner._doc):
        runner.emit("structure_warning", graphId=gid, **w)
    for w in find_delay_structure_warnings(runner._doc):
        runner.emit("structure_warning", graphId=gid, **w)
    for w in find_debounce_structure_warnings(runner._doc):
        runner.emit("structure_warning", graphId=gid, **w)
    for w in find_wait_for_structure_warnings(runner._doc):
        runner.emit("structure_warning", graphId=gid, **w)
    for w in find_llm_agent_structure_warnings(runner._doc):
        runner.emit("structure_warning", graphId=gid, **w)
    for w in find_agent_structure_warnings(runner._doc):
        runner.emit("structure_warning", graphId=gid, **w)
    for w in find_trigger_webhook_structure_warnings(runner._doc):
        runner.emit("structure_warning", graphId=gid, **w)
    for w in find_trigger_schedule_structure_warnings(runner._doc):
        runner.emit("structure_warning", graphId=gid, **w)
    # Same warnings may already appear in the editor from the graph document; NDJSON is for console parity.
    for w in find_port_data_kind_warnings(runner._doc):
        runner.emit("structure_warning", graphId=gid, **w)


def _prepare_node_execute_payload(node: Node) -> tuple[Any, dict[str, Any]]:
    """Return ``(exec_data, stored_node_data)`` with sensitive fields redacted for emission."""
    if node.type == "task":
        red_task = redact_task_data_for_node_execute(node.data)
        return red_task, (dict(node.data) if red_task is node.data else red_task)
    if node.type == "llm_agent":
        red_a = redact_task_data_for_node_execute(node.data)
        return red_a, (dict(node.data) if red_a is node.data else red_a)
    if node.type == "agent":
        red_ag = redact_task_data_for_node_execute(node.data)
        return red_ag, (dict(node.data) if red_ag is node.data else red_ag)
    if node.type == "mcp_tool":
        red_m = redact_mcp_tool_data_for_execute(node.data)
        return red_m, (dict(node.data) if red_m is node.data else red_m)
    if node.type == "http_request":
        red_h = redact_http_request_data_for_execute(dict(node.data))
        return red_h, (dict(node.data) if red_h is node.data else red_h)
    if node.type == "rag_query":
        red_r = redact_rag_query_data_for_execute(dict(node.data))
        return red_r, (dict(node.data) if red_r is node.data else red_r)
    if node.type == "rag_index":
        return dict(node.data), dict(node.data)
    if node.type == "python_code":
        red_p = redact_python_code_data_for_execute(dict(node.data))
        return red_p, (dict(node.data) if red_p is node.data else red_p)
    if node.type == "set_variable":
        return dict(node.data), dict(node.data)
    if node.type in ("delay", "debounce", "wait_for"):
        red_t = redact_timer_node_data_for_execute(dict(node.data))
        return red_t, (dict(node.data) if red_t is node.data else red_t)
    return node.data, dict(node.data)


def run_from_execution_phase(
    runner: Any,
    start_node_id: str,
    ctx: dict[str, Any],
    nd0: int,
    otel_tracer: Any,
) -> None:
    """Run the StepQueue dispatch loop.

    Pops execution frames, applies node-mode overrides (skipped/bypass), emits
    enter/execute/exit, delegates the typed body to the matching runner visit
    helper, and follows outgoing edges. Loop terminates on exit-node success,
    cancel, partial-stop, or cycle-guard exhaustion.
    """
    from graph_caster import otel_tracing

    _emit_structure_warnings(runner)
    ctx["graph_rev"] = graph_document_revision(runner._doc)
    step_q = StepQueue(start_node_id)
    visited_guard = 0
    max_steps = max(1, len(runner._doc.nodes) * 4)

    while step_q and visited_guard < max_steps:
        visited_guard += 1
        sess_coop = ctx.get("_gc_run_session")
        if sess_coop is not None and sess_coop.cancel_event.is_set():
            if nd0 == 0:
                runner.emit("run_end", reason="cancel_requested")
            ctx["_run_cancelled"] = True
            break
        frame = step_q.popleft()
        current_id = frame.node_id
        node = runner._node_by_id.get(current_id)
        if node is None:
            runner.emit("error", nodeId=current_id, message="unknown_node")
            break

        with otel_tracing.node_visit_span(
            otel_tracer,
            run_id=str(ctx.get("run_id") or ""),
            graph_id=runner._doc.graph_id,
            node_id=node.id,
            node_type=str(node.type),
        ):
            if _dispatch_one_frame(runner, node, ctx, step_q, otel_tracing):
                continue
            break

    if visited_guard >= max_steps:
        runner.emit("error", message="run_aborted_cycle_guard")
    elif (
        not ctx.get("_run_success")
        and not ctx.get("_run_cancelled")
        and not ctx.get("_run_partial_stop")
        and runner._has_incomplete_barrier(ctx)
    ):
        runner.emit("error", message="merge_barrier_incomplete")


def _dispatch_one_frame(
    runner: Any,
    node: Node,
    ctx: dict[str, Any],
    step_q: StepQueue,
    otel_tracing: Any,
) -> bool:
    """Execute one StepQueue frame; return ``True`` to keep looping, ``False`` to break."""
    runner.emit("node_enter", nodeId=node.id, nodeType=node.type, graphId=runner._doc.graph_id)

    _node_mode = getattr(node, "mode", "normal") or "normal"
    if is_skipped_mode(_node_mode):
        runner.emit(
            "node_skipped",
            nodeId=node.id,
            nodeType=node.type,
            mode=_node_mode,
            graphId=runner._doc.graph_id,
        )
        runner.emit(
            "node_exit",
            nodeId=node.id,
            nodeType=node.type,
            graphId=runner._doc.graph_id,
            skipped=True,
        )
        return True
    if is_bypass_mode(_node_mode):
        _outs_map = ctx.setdefault("node_outputs", {})
        _passthrough_entry, _has_pt = compute_bypass_passthrough(
            node, runner._incoming_success_sources(node.id), _outs_map
        )
        _outs_map[node.id] = _passthrough_entry
        runner.emit(
            "node_bypassed",
            nodeId=node.id,
            nodeType=node.type,
            graphId=runner._doc.graph_id,
            passThrough=_has_pt,
        )
        runner.emit(
            "node_exit",
            nodeId=node.id,
            nodeType=node.type,
            graphId=runner._doc.graph_id,
            bypassed=True,
        )
        if not ctx.get("_run_cancelled"):
            ctx["last_result"] = True
            if runner._follow_edges_from(node.id, ctx, error_route=False, step_q=step_q):
                return True
        return False

    exec_data, stored_node_data = _prepare_node_execute_payload(node)
    runner.emit("node_execute", nodeId=node.id, nodeType=node.type, data=exec_data)

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
            with runner._state_lock:
                st = (ctx.get("_gc_merge_barrier") or {}).get(node.id, {})
                arrived = set(st.get("arrived") or set())
            outs_map[node.id]["merge"] = {
                "passthrough": False,
                "barrier": True,
                "arrivedFrom": sorted(arrived),
            }
        else:
            outs_map[node.id]["merge"] = {"passthrough": True}

    body_outcome = _run_node_body(runner, node, ctx, step_q, otel_tracing)
    if body_outcome == "continue":
        return True
    if body_outcome == "break":
        return False
    # body_outcome is ("ok", used_pin) tuple for typed visits, or "noop"
    if isinstance(body_outcome, tuple) and body_outcome[0] == "ok":
        task_exit_used_pin = bool(body_outcome[1])

    runner._merge_run_variables_from_node_output(ctx, node.id)

    ne: dict[str, Any] = {
        "nodeId": node.id,
        "nodeType": node.type,
        "graphId": runner._doc.graph_id,
    }
    if task_exit_used_pin:
        ne["usedPin"] = True
    if node.type != "ai_route":
        runner.emit("node_exit", **ne)

    if node.type == "exit":
        runner.emit("run_success", nodeId=node.id, graphId=runner._doc.graph_id)
        ctx["_run_success"] = True
        return False

    if (
        runner._stop_after_node_id is not None
        and runner._stop_after_node_id == node.id
        and not ctx.get("_run_cancelled")
    ):
        ctx["_run_partial_stop"] = True
        return False

    if node.type == "fork":
        if not runner._enqueue_fork_branches(node.id, ctx, step_q):
            otel_tracing.mark_current_span_error("fork_enqueue_failed")
            return False
        return True
    if node.type == "ai_route":
        ctx["last_result"] = True
        ok_ai = runner._follow_ai_route_from(node, ctx, step_q)
        runner.emit("node_exit", **ne)
        if not ok_ai:
            otel_tracing.mark_current_span_error("ai_route_failed")
            return False
        return True
    if not runner._follow_edges_from(node.id, ctx, error_route=False, step_q=step_q):
        otel_tracing.mark_current_span_error("no_successor_edges")
        return False
    return True


def _run_node_body(
    runner: Any,
    node: Node,
    ctx: dict[str, Any],
    step_q: StepQueue,
    otel_tracing: Any,
) -> Any:
    """Execute the typed body of a node and translate the result for the dispatch loop.

    Returns:
        * ``"continue"`` — caller should ``continue`` the outer loop
        * ``"break"`` — caller should ``break`` the outer loop
        * ``("ok", used_pin: bool)`` — typed visit succeeded
        * ``"noop"`` — no typed body for this node-type (control-flow handled below)
    """
    if is_editor_frame_node_type(node.type):
        return "noop"
    if node.type == "graph_ref":
        ok = runner._execute_graph_ref(node, ctx)
        if not ok:
            otel_tracing.mark_current_span_error("graph_ref_failed")
            runner.emit("node_exit", nodeId=node.id, nodeType=node.type, graphId=runner._doc.graph_id)
            if not ctx.get("_run_cancelled"):
                ctx["last_result"] = False
                if runner._follow_edges_from(node.id, ctx, error_route=True, step_q=step_q):
                    return "continue"
            return "break"
        return "noop"
    if node.type == "mcp_tool":
        ok = runner._execute_mcp_tool(node, ctx)
        if not ok:
            otel_tracing.mark_current_span_error("mcp_tool_failed")
            runner.emit("node_exit", nodeId=node.id, nodeType=node.type, graphId=runner._doc.graph_id)
            if not ctx.get("_run_cancelled"):
                ctx["last_result"] = False
                if runner._follow_edges_from(node.id, ctx, error_route=True, step_q=step_q):
                    return "continue"
            return "break"
        return "noop"

    from graph_caster.runner.dispatch_tables import dispatch_visit

    outcome_pair = dispatch_visit(runner, node, ctx, step_q)
    if outcome_pair is not None:
        outcome, used_pin = outcome_pair
        if outcome == "continue":
            otel_tracing.mark_current_span_error(f"{node.type}_continue_non_ok")
            return "continue"
        if outcome == "break":
            otel_tracing.mark_current_span_error(f"{node.type}_break_non_ok")
            return "break"
        return ("ok", used_pin)
    return "noop"


def run_from_root_finally(runner: Any, ctx: dict[str, Any], nd0: int, root_span: Any) -> None:
    """Terminal accounting + hooks for the root run.

    Determines final status (success/failed/cancelled/partial), emits
    ``run_finished``, fires webhook + audit + plugin hooks, writes run-summary
    artifacts and schedules S3 upload, then closes any persistent NDJSON sink
    and marks the session-registry slot complete.
    """
    if nd0 == 0 and runner._run_id:
        if ctx.get("_run_cancelled"):
            st = "cancelled"
        elif ctx.get("_run_partial_stop"):
            st = "partial"
        elif ctx.get("_run_success"):
            st = "success"
        else:
            st = "failed"
        finished_at = datetime.now(UTC).isoformat()
        runner.emit(
            "run_finished",
            rootGraphId=runner._doc.graph_id,
            status=st,
            finishedAt=finished_at,
        )
        _notify_payload: dict[str, Any] = {
            "schemaVersion": 1,
            "type": "run_finished",
            "runId": runner._run_id,
            "rootGraphId": runner._doc.graph_id,
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

            wr = runner._host.resolved_workspace_root()
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
            if runner._persist_run_events:
                rrd = ctx.get("root_run_artifact_dir")
                if rrd:
                    from graph_caster.artifacts import write_run_summary

                    summary_payload: dict[str, Any] = {
                        "schemaVersion": 1,
                        "runId": runner._run_id,
                        "rootGraphId": runner._doc.graph_id,
                        "status": st,
                        "startedAt": ctx.get("_gc_started_at_iso"),
                        "finishedAt": finished_at,
                    }
                    rrd_path = Path(str(rrd))
                    write_run_summary(rrd_path, summary_payload)
                    ab_host = runner._host.artifacts_base
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
                                graph_id=runner._doc.graph_id,
                                run_id=runner._run_id,
                            )
                        except Exception:
                            _LOG.debug("S3 schedule after summary failed", exc_info=True)
        finally:
            if runner._persist_file_sink is not None:
                runner._persist_file_sink.close()
                runner._persist_file_sink = None
            if runner._session_registry is not None:
                runner._session_registry.complete(runner._run_id, st)

    from graph_caster import otel_tracing

    otel_tracing.finalize_root_run_span(root_span, ctx)


def execute_graph_ref(runner: Any, node: Node, ctx: dict[str, Any]) -> bool:
    """Recurse into a nested graph (subprocess or in-process) and propagate result."""
    from graph_caster.validate import GraphStructureError, validate_graph_structure
    from graph_caster.workspace import WorkspaceIndexError, resolve_graph_path

    root = runner._host.graphs_root
    if root is None:
        runner.emit("error", nodeId=node.id, message="graph_ref_requires_graphs_directory")
        return False

    target_id = node.data.get("targetGraphId") or node.data.get("graphId")
    if not target_id:
        runner.emit("error", nodeId=node.id, message="graph_ref_missing_targetGraphId")
        return False
    target_id = str(target_id)

    try:
        path = resolve_graph_path(root, target_id)
    except WorkspaceIndexError as e:
        runner.emit("error", nodeId=node.id, message=str(e))
        return False

    if path is None:
        runner.emit("error", nodeId=node.id, message=f"unknown targetGraphId {target_id!r}")
        return False

    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as e:
        runner.emit("error", nodeId=node.id, message=f"cannot load nested graph: {e}")
        return False

    try:
        nested = GraphDocument.from_dict(raw)
    except ValueError as e:
        runner.emit("error", nodeId=node.id, message=f"nested graph invalid document: {e}")
        return False
    try:
        validate_graph_structure(nested)
    except GraphStructureError as e:
        runner.emit("error", nodeId=node.id, message=f"nested graph invalid: {e}")
        return False

    ndepth = int(ctx.get("nesting_depth", 0))
    maxd = int(ctx.get("max_nesting_depth", 16))
    if ndepth >= maxd:
        runner.emit("error", nodeId=node.id, message="max_nesting_depth_exceeded")
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
    runner.emit("nested_graph_enter", **nested_payload)

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
            sink=runner._event_sink,
            host=runner._host,
            run_id=runner._run_id,
            step_cache=runner._step_cache,
            run_session=sess_coop,
            public_stream=runner._public_stream,
        )
    else:
        from graph_caster.runner.graph_runner import GraphRunner

        child = GraphRunner(
            nested,
            runner._event_sink,
            host=runner._host,
            run_id=runner._run_id,
            session_registry=runner._session_registry,
            stop_after_node_id=None,
            step_cache=runner._step_cache,
            persist_run_events=False,
            public_stream=runner._public_stream,
        )
        child.run(context=child_ctx)

    runner.emit(
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
        runner.emit(
            "error",
            nodeId=node.id,
            message="nested_graph_run_incomplete",
            targetGraphId=target_id,
        )
        return False
    return True


def merge_run_variables_from_node_output(ctx: dict[str, Any], node_id: str) -> None:
    """Reflect ``runVariables`` and ``runVariablesRemove`` from a node output into the run pool."""
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
