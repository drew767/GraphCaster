# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
import uuid
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from graph_caster.host_context import RunHostContext
from graph_caster.models import Edge, GraphDocument, Node

RunEvent = dict[str, Any]
EventSink = Callable[[RunEvent], None]


def _edges_from(node_id: str, doc: GraphDocument) -> list[Edge]:
    return [e for e in doc.edges if e.source == node_id]


def _pick_next_edge(edges: list[Edge], context: dict[str, Any]) -> Edge | None:
    if not edges:
        return None
    for e in edges:
        if e.condition is None or e.condition.strip() == "":
            return e
        if _eval_edge_condition(e.condition, context):
            return e
    return None


def _eval_edge_condition(condition: str, context: dict[str, Any]) -> bool:
    if condition.strip().lower() in {"true", "1", "yes"}:
        return True
    if condition.strip().lower() in {"false", "0", "no"}:
        return False
    return bool(context.get("last_result"))


def _task_has_process_command(node: Node) -> bool:
    d = node.data
    return d.get("command") is not None or d.get("argv") is not None


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
    ) -> None:
        if host is not None and graphs_root is not None:
            raise ValueError("pass only one of host= or graphs_root=")
        if host is None:
            host = RunHostContext(graphs_root=graphs_root)
        self._doc = document
        self._sink = sink or (lambda _e: None)
        self._host = host
        self._run_id = run_id

    def emit(self, event_type: str, **payload: Any) -> None:
        ev: RunEvent = {"type": event_type, **payload}
        rid = self._run_id
        if rid:
            ev["runId"] = rid
        self._sink(ev)

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
        ctx["_run_success"] = False
        nd0 = int(ctx.get("nesting_depth", 0))
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
            started_payload: dict[str, Any] = {
                "rootGraphId": self._doc.graph_id,
                "startedAt": datetime.now(UTC).isoformat(),
                "mode": _run_mode_wire(ctx),
            }
            if self._doc.title:
                started_payload["graphTitle"] = self._doc.title
            self.emit("run_started", **started_payload)
        try:
            if nd0 == 0 and not ctx.get("root_run_artifact_dir"):
                ab = self._host.artifacts_base
                if ab is not None:
                    from graph_caster.artifacts import create_root_run_artifact_dir

                    run_dir = create_root_run_artifact_dir(ab, self._doc.graph_id)
                    path_str = str(run_dir)
                    ctx["root_run_artifact_dir"] = path_str
                    self.emit("run_root_ready", rootGraphId=self._doc.graph_id, rootRunArtifactDir=path_str)
            node_by_id: dict[str, Node] = {n.id: n for n in self._doc.nodes}
            current_id: str | None = start_node_id
            visited_guard = 0
            max_steps = max(1, len(self._doc.nodes) * 4)

            while current_id is not None and visited_guard < max_steps:
                visited_guard += 1
                node = node_by_id.get(current_id)
                if node is None:
                    self.emit("error", nodeId=current_id, message="unknown_node")
                    break

                self.emit("node_enter", nodeId=node.id, nodeType=node.type, graphId=self._doc.graph_id)
                self.emit("node_execute", nodeId=node.id, nodeType=node.type, data=node.data)

                outs_map = ctx.setdefault("node_outputs", {})
                outs_map[node.id] = {"nodeType": node.type, "data": dict(node.data)}

                if node.type == "comment":
                    pass
                elif node.type == "graph_ref":
                    ok = self._execute_graph_ref(node, ctx)
                    if not ok:
                        self.emit("node_exit", nodeId=node.id, nodeType=node.type, graphId=self._doc.graph_id)
                        break
                elif node.type == "task" and _task_has_process_command(node):
                    from graph_caster.process_exec import run_task_process

                    ok = run_task_process(
                        node_id=node.id,
                        graph_id=self._doc.graph_id,
                        data=dict(node.data),
                        ctx=ctx,
                        emit=self.emit,
                    )
                    if not ok:
                        self.emit("node_exit", nodeId=node.id, nodeType=node.type, graphId=self._doc.graph_id)
                        break

                self.emit("node_exit", nodeId=node.id, nodeType=node.type, graphId=self._doc.graph_id)

                if node.type == "exit":
                    self.emit("run_success", nodeId=node.id, graphId=self._doc.graph_id)
                    ctx["_run_success"] = True
                    break

                outs = _edges_from(node.id, self._doc)
                chosen = _pick_next_edge(outs, ctx)
                if chosen is None:
                    self.emit("run_end", reason="no_outgoing_or_no_matching_condition")
                    break
                self.emit(
                    "edge_traverse",
                    edgeId=chosen.id,
                    fromNode=chosen.source,
                    toNode=chosen.target,
                )
                current_id = chosen.target

            if visited_guard >= max_steps:
                self.emit("error", message="run_aborted_cycle_guard")
        finally:
            if nd0 == 0 and self._run_id:
                st = "success" if ctx.get("_run_success") else "failed"
                self.emit(
                    "run_finished",
                    rootGraphId=self._doc.graph_id,
                    status=st,
                    finishedAt=datetime.now(UTC).isoformat(),
                )

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

        child = GraphRunner(nested, self._sink, host=self._host, run_id=self._run_id)
        child.run(context=child_ctx)

        self.emit(
            "nested_graph_exit",
            parentNodeId=node.id,
            targetGraphId=target_id,
            depth=depth_next,
        )
        nested_ok = bool(child_ctx.get("_run_success", False))
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
