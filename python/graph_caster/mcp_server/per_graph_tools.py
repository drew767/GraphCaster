# Copyright GraphCaster. All Rights Reserved.

"""Per-graph MCP tool registration (F65).

Each graph discovered in ``graphs/`` is exposed as a first-class MCP tool named
``gc_<sanitized_graphId>``.  The tool's JSON Schema is derived from the ``start``
node's ``data.inputSchema`` (explicit) or ``data.inputs`` list (inferred).  Output is
taken from the ``exit`` node's ``data.outputSchema`` / ``data.outputs`` list.

Hot-reload: pass ``watch=True`` to :func:`register_per_graph_tools`; a daemon thread
polls the graphs directory every 10 s (mtime-based) and re-registers changed tools.

Export-only mode: :func:`build_single_graph_fastmcp` returns a ``FastMCP`` instance
that exposes exactly one graph as a tool.
"""

from __future__ import annotations

import json
import re
import threading
import time
import uuid
from collections import deque
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError
from pathlib import Path
from typing import Any

from graph_caster.host_context import RunHostContext
from graph_caster.models import GraphDocument, Node
from graph_caster.run_event_sink import CallableRunEventSink, RunEventDict
from graph_caster.runner import GraphRunner
from graph_caster.run_sessions import get_default_run_registry
from graph_caster.validate import GraphStructureError, validate_graph_structure
from graph_caster.workspace import WorkspaceIndexError, load_graph_documents_index

try:
    from mcp.server.fastmcp.tools import Tool as _FastMCPTool
    from mcp.server.fastmcp.utilities.func_metadata import func_metadata as _func_metadata

    class _PerGraphTool(_FastMCPTool):
        """Custom FastMCP Tool that passes MCP arguments directly to the handler as ``**kwargs``,
        bypassing FastMCP's pydantic arg-model validation (which doesn't know the dynamic schema).
        The custom JSON Schema is stored in ``parameters`` for schema advertisement.
        """

        async def run(self, arguments: dict[str, Any], context: Any = None, convert_result: bool = False) -> Any:
            return await self.fn(**arguments)

    async def _dummy_fn() -> None:
        pass

    _DUMMY_FN_METADATA = _func_metadata(_dummy_fn)

except ImportError:
    _PerGraphTool = None  # type: ignore[assignment,misc]
    _DUMMY_FN_METADATA = None

_WATCH_INTERVAL_SEC = 10.0
_GRACE_SEC = 120.0

_TYPE_MAP: dict[str, str] = {
    "string": "string",
    "str": "string",
    "number": "number",
    "float": "number",
    "integer": "integer",
    "int": "integer",
    "boolean": "boolean",
    "bool": "boolean",
    "object": "object",
    "array": "array",
    "null": "null",
}


def _sanitize_tool_name(graph_id: str) -> str:
    """Return ``gc_<sanitized>`` where non-alnum chars become ``_``."""
    slug = re.sub(r"[^a-zA-Z0-9]", "_", graph_id).lower()
    slug = re.sub(r"_+", "_", slug).strip("_")
    return f"gc_{slug}"


def _inputs_list_to_schema(inputs: list[Any]) -> dict[str, Any]:
    """Convert ``data.inputs`` list entries into a JSON Schema object."""
    properties: dict[str, Any] = {}
    required: list[str] = []
    for item in inputs:
        if not isinstance(item, dict):
            continue
        name = (item.get("name") or "").strip()
        if not name:
            continue
        raw_type = str(item.get("type") or "string").strip().lower()
        json_type = _TYPE_MAP.get(raw_type, "string")
        prop: dict[str, Any] = {"type": json_type}
        desc = (item.get("description") or "").strip()
        if desc:
            prop["description"] = desc
        properties[name] = prop
        if item.get("required"):
            required.append(name)
    schema: dict[str, Any] = {"type": "object", "properties": properties}
    if required:
        schema["required"] = required
    return schema


def _outputs_list_to_schema(outputs: list[Any]) -> dict[str, Any]:
    return _inputs_list_to_schema(outputs)


def derive_input_schema(start_node: Node) -> dict[str, Any]:
    """Derive JSON Schema from the start node's data."""
    d = start_node.data
    if isinstance(d.get("inputSchema"), dict):
        return dict(d["inputSchema"])
    if isinstance(d.get("inputs"), list):
        return _inputs_list_to_schema(d["inputs"])
    return {"type": "object", "properties": {}}


def derive_output_schema(exit_node: Node) -> dict[str, Any]:
    """Derive JSON Schema from the exit node's data."""
    d = exit_node.data
    if isinstance(d.get("outputSchema"), dict):
        return dict(d["outputSchema"])
    if isinstance(d.get("outputs"), list):
        return _outputs_list_to_schema(d["outputs"])
    return {"type": "object", "properties": {}}


def _find_start_exit(doc: GraphDocument) -> tuple[Node | None, Node | None]:
    start: Node | None = None
    exit_: Node | None = None
    for n in doc.nodes:
        if n.type == "start" and start is None:
            start = n
        elif n.type == "exit" and exit_ is None:
            exit_ = n
    return start, exit_


def _validate_tool_inputs(
    inputs: dict[str, Any],
    schema: dict[str, Any],
) -> list[str]:
    """Return list of error strings (empty means valid)."""
    errors: list[str] = []
    required = schema.get("required") or []
    for field in required:
        if field not in inputs:
            errors.append(f"missing required field: {field!r}")
    return errors


def _summarize_event(ev: RunEventDict) -> dict[str, Any]:
    t = ev.get("type", "?")
    out: dict[str, Any] = {"type": t}
    if "nodeId" in ev:
        out["nodeId"] = ev["nodeId"]
    if t == "run_finished" and "status" in ev:
        out["status"] = ev["status"]
    return out


def _run_graph_with_inputs(
    host: RunHostContext,
    doc: GraphDocument,
    start_node: Node,
    exit_node: Node | None,
    inputs: dict[str, Any],
    timeout_sec: float = 600.0,
    max_event_briefs: int = 80,
) -> dict[str, Any]:
    """Execute a graph with inputs injected into the start node's output slot.

    Returns the exit node's output dict (or error dict).
    """
    briefs: deque[dict[str, Any]] = deque(maxlen=max(10, min(int(max_event_briefs), 200)))

    def sink_fn(ev: RunEventDict) -> None:
        briefs.append(_summarize_event(ev))

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
    if inputs:
        ctx.setdefault("node_outputs", {})[start_node.id] = dict(inputs)

    timeout = max(1.0, min(float(timeout_sec), 86400.0))
    tool_wait_timed_out = False

    def _run() -> None:
        runner.run(context=ctx)

    try:
        with ThreadPoolExecutor(max_workers=1) as ex:
            fut = ex.submit(_run)
            try:
                fut.result(timeout=timeout)
            except FuturesTimeoutError:
                tool_wait_timed_out = True
                get_default_run_registry().request_cancel(run_uuid)
                try:
                    fut.result(timeout=_GRACE_SEC)
                except FuturesTimeoutError:
                    return {
                        "ok": False,
                        "error": (
                            f"run timed out after {timeout} seconds; cooperative cancel was requested "
                            f"but the worker did not finish within {_GRACE_SEC}s"
                        ),
                        "runId": run_uuid,
                        "graphId": doc.graph_id,
                        "eventBriefs": list(briefs),
                        "workerStillRunning": True,
                    }
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

    result: dict[str, Any] = {
        "ok": status == "success",
        "status": status,
        "runId": run_uuid,
        "graphId": doc.graph_id,
        "eventBriefs": list(briefs),
    }
    if tool_wait_timed_out:
        result["toolWaitTimedOut"] = True

    if exit_node is not None:
        outs_map = ctx.get("node_outputs") or {}
        exit_out = outs_map.get(exit_node.id)
        if isinstance(exit_out, dict):
            filtered = {k: v for k, v in exit_out.items() if k not in ("nodeType", "data")}
            if filtered:
                result["output"] = filtered
            else:
                result["output"] = {}
        else:
            result["output"] = {}

    return result


def _load_index_safe(graphs_dir: Path) -> dict[str, tuple[Path, GraphDocument]]:
    try:
        return load_graph_documents_index(graphs_dir)
    except WorkspaceIndexError:
        return {}


def _graphs_max_mtime(graphs_dir: Path) -> float:
    try:
        mt = graphs_dir.stat().st_mtime
    except OSError:
        mt = 0.0
    try:
        for p in graphs_dir.glob("*.json"):
            try:
                m = p.stat().st_mtime
                if m > mt:
                    mt = m
            except OSError:
                pass
    except OSError:
        pass
    return mt


def _build_tool_for_graph(
    mcp: Any,
    host: RunHostContext,
    graph_id: str,
    doc: GraphDocument,
    tool_name: str,
) -> None:
    """Register one MCP tool on ``mcp`` for the given graph document.

    Uses :class:`_PerGraphTool` (a FastMCP Tool subclass) to advertise the
    derived JSON Schema while passing arguments directly to the async handler,
    bypassing FastMCP's pydantic arg-model validation which cannot know the
    dynamic schema at import time.
    """
    if _PerGraphTool is None or _DUMMY_FN_METADATA is None:
        return

    start_node, exit_node = _find_start_exit(doc)
    if start_node is None:
        return

    input_schema = derive_input_schema(start_node)
    title = (doc.title or graph_id).strip()
    description = title
    input_required = input_schema.get("required") or []

    def _make_handler(
        _host: RunHostContext,
        _doc: GraphDocument,
        _start: Node,
        _exit: Node | None,
        _schema: dict[str, Any],
        _req: list[str],
    ):
        async def handler(**kwargs: Any) -> dict[str, Any]:
            import anyio

            errors = _validate_tool_inputs(kwargs, {"required": _req, "properties": _schema.get("properties", {})})
            if errors:
                return {"ok": False, "error": "; ".join(errors), "validationErrors": errors}

            def _call() -> dict[str, Any]:
                return _run_graph_with_inputs(_host, _doc, _start, _exit, dict(kwargs))

            return await anyio.to_thread.run_sync(_call)

        return handler

    handler = _make_handler(host, doc, start_node, exit_node, input_schema, input_required)

    tool = _PerGraphTool.model_construct(
        fn=handler,
        name=tool_name,
        title=title,
        description=description,
        parameters=input_schema,
        fn_metadata=_DUMMY_FN_METADATA,
        is_async=True,
        context_kwarg=None,
        annotations=None,
        icons=None,
        meta=None,
    )

    try:
        mcp._tool_manager._tools[tool_name] = tool
    except Exception:
        pass


def register_per_graph_tools(
    mcp: Any,
    host: RunHostContext,
    *,
    watch: bool = False,
) -> None:
    """Discover graphs and register one tool per graph on ``mcp``.

    If ``watch=True``, a background daemon thread polls every
    :data:`_WATCH_INTERVAL_SEC` seconds for mtime changes and re-registers new
    tools.  Existing tools cannot be removed from FastMCP at runtime (limitation),
    so only newly discovered graphs get registered.
    """
    if host.graphs_root is None:
        return

    _registered: set[str] = set()

    def _register_new_graphs() -> None:
        index = _load_index_safe(host.graphs_root)  # type: ignore[arg-type]
        for gid, (_, doc) in index.items():
            if gid in _registered:
                continue
            tool_name = _sanitize_tool_name(gid)
            _build_tool_for_graph(mcp, host, gid, doc, tool_name)
            _registered.add(gid)

    _register_new_graphs()

    if not watch:
        return

    last_mtime: list[float] = [_graphs_max_mtime(host.graphs_root)]  # type: ignore[arg-type]

    def _watch_loop() -> None:
        while True:
            time.sleep(_WATCH_INTERVAL_SEC)
            try:
                mt = _graphs_max_mtime(host.graphs_root)  # type: ignore[arg-type]
            except Exception:
                continue
            if mt != last_mtime[0]:
                last_mtime[0] = mt
                try:
                    _register_new_graphs()
                except Exception:
                    pass

    t = threading.Thread(target=_watch_loop, daemon=True, name="gc-mcp-watch")
    t.start()


def build_single_graph_fastmcp(
    host: RunHostContext,
    graph_id: str,
) -> Any:
    """Return a ``FastMCP`` instance exposing only one graph as a tool.

    Raises :class:`ValueError` if the graph cannot be found or loaded.
    """
    from mcp.server.fastmcp import FastMCP

    if host.graphs_root is None:
        raise ValueError("graphs_root is not configured")

    index = _load_index_safe(host.graphs_root)
    if graph_id not in index:
        raise ValueError(f"graph {graph_id!r} not found in {host.graphs_root}")

    _, doc = index[graph_id]
    try:
        validate_graph_structure(doc)
    except GraphStructureError as e:
        raise ValueError(f"invalid graph structure: {e}") from e

    tool_name = _sanitize_tool_name(graph_id)
    title = (doc.title or graph_id).strip()

    mcp = FastMCP(
        f"GraphCaster:{graph_id}",
        instructions=(
            f"Single-graph MCP server for '{title}' (graphId: {graph_id}). "
            "Call the exposed tool to run this graph."
        ),
    )
    _build_tool_for_graph(mcp, host, graph_id, doc, tool_name)
    return mcp


def list_per_graph_tool_names(host: RunHostContext) -> list[str]:
    """Return the tool names that would be registered for the given graphs directory.

    Used for introspection/testing without spinning up an MCP server.
    """
    if host.graphs_root is None:
        return []
    index = _load_index_safe(host.graphs_root)
    return [_sanitize_tool_name(gid) for gid in sorted(index.keys())]
