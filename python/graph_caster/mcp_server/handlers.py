# Copyright GraphCaster. All Rights Reserved.

"""Sync handlers for MCP tools (no ``mcp`` import — testable without optional extra)."""

from __future__ import annotations

import json
import uuid
from collections import deque
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from pathlib import Path
from typing import Any

from graph_caster.host_context import RunHostContext
from graph_caster.models import GraphDocument
from graph_caster.run_event_sink import CallableRunEventSink, RunEventDict
from graph_caster.runner import GraphRunner
from graph_caster.run_sessions import get_default_run_registry
from graph_caster.validate import GraphStructureError, validate_graph_structure
from graph_caster.workspace import WorkspaceIndexError, load_graph_documents_index

# After tool `timeout_sec`, wait this long for the runner to observe cooperative cancel between steps.
_GRACE_AFTER_TOOL_TIMEOUT_SEC = 120.0


def _check_graph_ref_cycles(graphs_root: Path) -> str | None:
    from graph_caster.graph_ref_workspace import build_workspace_graph_ref_adjacency, find_workspace_graph_ref_cycle

    try:
        adj = build_workspace_graph_ref_adjacency(graphs_root)
    except WorkspaceIndexError as e:
        return str(e)
    cyc = find_workspace_graph_ref_cycle(adj)
    if not cyc:
        return None
    if len(cyc) == 1:
        chain = f"{cyc[0]} -> {cyc[0]}"
    else:
        chain = " -> ".join(cyc + [cyc[0]])
    return f"graph_ref dependency cycle in workspace: {chain}"


def _safe_graph_file_under_root(graphs_root: Path, relative_path: str) -> Path:
    """Resolve a *.json file name or single-segment path strictly under ``graphs_root``."""
    root = graphs_root.resolve()
    raw = Path(relative_path.replace("\\", "/").strip())
    if raw.is_absolute():
        raise ValueError("relativePath must not be absolute")
    parts = raw.parts
    if any(p == ".." for p in parts):
        raise ValueError("relativePath must not contain '..'")
    if len(parts) != 1:
        raise ValueError("relativePath must be a single file name (e.g. my-graph.json)")
    name = parts[0]
    if not name.endswith(".json"):
        raise ValueError("relativePath must end with .json")
    candidate = (root / name).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as e:
        raise ValueError("relativePath escapes graphs directory") from e
    return candidate


def list_graphs_handler(
    host: RunHostContext,
    *,
    limit: int = 200,
    include_titles: bool = False,
) -> dict[str, Any]:
    gr = host.graphs_root
    if gr is None:
        return {"ok": False, "error": "graphs_root is not configured (use --graphs-dir)"}
    lim = max(1, min(int(limit), 500))
    try:
        index = load_graph_documents_index(gr)
    except WorkspaceIndexError as e:
        return {"ok": False, "error": str(e)}
    items: list[dict[str, Any]] = []
    for gid, (path, doc) in sorted(index.items(), key=lambda x: x[0])[:lim]:
        row: dict[str, Any] = {"graphId": gid, "fileName": path.name}
        if include_titles and doc.title:
            row["title"] = str(doc.title)
        items.append(row)
    return {"ok": True, "graphs": items, "count": len(items)}


def _summarize_event(ev: RunEventDict) -> dict[str, Any]:
    t = ev.get("type", "?")
    out: dict[str, Any] = {"type": t}
    if "nodeId" in ev:
        out["nodeId"] = ev.get("nodeId")
    if t == "run_finished" and "status" in ev:
        out["status"] = ev.get("status")
    return out


def run_graph_handler(
    host: RunHostContext,
    *,
    graph_id: str | None = None,
    relative_path: str | None = None,
    timeout_sec: float = 600.0,
    dry_run_validate_only: bool = False,
    max_event_briefs: int = 80,
    on_event: Callable[[RunEventDict], None] | None = None,
) -> dict[str, Any]:
    gr = host.graphs_root
    if gr is None:
        return {"ok": False, "error": "graphs_root is not configured (use --graphs-dir)"}

    gid_in = (graph_id or "").strip() or None
    rel = (relative_path or "").strip() or None
    if bool(gid_in) == bool(rel):
        return {"ok": False, "error": "Provide exactly one of graphId or relativePath"}

    doc_path: Path | None = None
    if rel is not None:
        try:
            doc_path = _safe_graph_file_under_root(gr, rel)
        except ValueError as e:
            return {"ok": False, "error": str(e)}
        if not doc_path.is_file():
            return {"ok": False, "error": f"graph file not found: {doc_path.name}"}
    else:
        assert gid_in is not None
        from graph_caster.workspace import resolve_graph_path

        doc_path = resolve_graph_path(gr, gid_in)
        if doc_path is None:
            return {"ok": False, "error": f"unknown graphId {gid_in!r}"}

    try:
        raw = json.loads(doc_path.read_text(encoding="utf-8"))
        doc = GraphDocument.from_dict(raw)
    except (OSError, json.JSONDecodeError, ValueError) as e:
        return {"ok": False, "error": f"cannot load graph: {e}"}

    cycle_err = _check_graph_ref_cycles(gr)
    if cycle_err:
        return {"ok": False, "error": cycle_err}

    try:
        validate_graph_structure(doc)
    except GraphStructureError as e:
        return {"ok": False, "error": str(e)}

    if dry_run_validate_only:
        return {
            "ok": True,
            "dryRun": True,
            "graphId": doc.graph_id,
            "fileName": doc_path.name,
            "nodeCount": len(doc.nodes),
            "edgeCount": len(doc.edges),
        }

    briefs: deque[dict[str, Any]] = deque(maxlen=max(10, min(int(max_event_briefs), 200)))

    def sink_fn(ev: RunEventDict) -> None:
        briefs.append(_summarize_event(ev))
        if on_event is not None:
            on_event(ev)

    sink = CallableRunEventSink(sink_fn)
    run_uuid = str(uuid.uuid4())
    artifacts_base = host.artifacts_base
    persist = artifacts_base is not None

    runner = GraphRunner(
        doc,
        sink=sink,
        host=host,
        run_id=run_uuid,
        session_registry=get_default_run_registry(),
        persist_run_events=persist,
    )

    ctx: dict[str, Any] = {"last_result": True}
    timeout = max(1.0, min(float(timeout_sec), 86400.0))

    def _run() -> None:
        runner.run(context=ctx)

    tool_wait_timed_out = False
    try:
        with ThreadPoolExecutor(max_workers=1) as ex:
            fut = ex.submit(_run)
            try:
                fut.result(timeout=timeout)
            except FuturesTimeoutError:
                tool_wait_timed_out = True
                get_default_run_registry().request_cancel(run_uuid)
                try:
                    fut.result(timeout=_GRACE_AFTER_TOOL_TIMEOUT_SEC)
                except FuturesTimeoutError:
                    return {
                        "ok": False,
                        "error": (
                            f"run timed out after {timeout} seconds; cooperative cancel was requested but the "
                            f"worker did not finish within {_GRACE_AFTER_TOOL_TIMEOUT_SEC}s "
                            "(do not start another long run in this MCP process until this one stops)"
                        ),
                        "runId": run_uuid,
                        "graphId": doc.graph_id,
                        "eventBriefs": list(briefs),
                        "workerStillRunning": True,
                    }
                # Runner finished after cancel (or finished racing the timeout).
    except Exception as e:
        return {
            "ok": False,
            "error": f"run failed: {e}",
            "runId": run_uuid,
            "graphId": doc.graph_id,
            "eventBriefs": list(briefs),
        }

    if ctx.get("_run_cancelled"):
        status = "cancelled"
    elif ctx.get("_run_partial_stop"):
        status = "partial"
    elif ctx.get("_run_success"):
        status = "success"
    else:
        status = "failed"

    rrd = ctx.get("root_run_artifact_dir")
    out: dict[str, Any] = {
        "ok": status == "success",
        "status": status,
        "runId": run_uuid,
        "graphId": doc.graph_id,
        "eventBriefs": list(briefs),
    }
    if tool_wait_timed_out:
        out["toolWaitTimedOut"] = True
    if isinstance(rrd, str) and rrd.strip():
        out["rootRunArtifactDir"] = rrd.strip()
    return out


def cancel_run_handler(run_id: str) -> dict[str, Any]:
    """Request cooperative cancel for a run in this MCP process (same registry as ``graphcaster_run_graph``).

    Matches timeout behavior: ``RunSessionRegistry.request_cancel`` sets the session's cancel event; the
    worker observes it between runner steps. Does not stop subprocesses inside a node.

    Response contract: ``ok`` means the arguments were accepted (valid UUID after trim). Whether cancel was
    applied to an active run is ``cancelRequested``; if false, see ``reason`` (``unknown_run_id`` /
    ``run_not_active``).
    """
    rid = (run_id or "").strip()
    if not rid:
        return {"ok": False, "error": "runId is required"}
    try:
        normalized = str(uuid.UUID(rid))
    except ValueError:
        return {"ok": False, "error": "invalid runId (expected UUID)"}

    reg = get_default_run_registry()
    if reg.request_cancel(normalized):
        return {"ok": True, "cancelRequested": True, "runId": normalized}

    session = reg.get(normalized)
    if session is None:
        reason = "unknown_run_id"
    else:
        reason = "run_not_active"
    return {
        "ok": True,
        "cancelRequested": False,
        "runId": normalized,
        "reason": reason,
    }
