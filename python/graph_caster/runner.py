# Copyright Aura. All Rights Reserved.

from __future__ import annotations

from collections.abc import Callable
from typing import Any

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


class GraphRunner:
    def __init__(self, document: GraphDocument, sink: EventSink | None = None) -> None:
        self._doc = document
        self._sink = sink or (lambda _e: None)

    def emit(self, event_type: str, **payload: Any) -> None:
        ev: RunEvent = {"type": event_type, **payload}
        self._sink(ev)

    def run_from(self, start_node_id: str, context: dict[str, Any] | None = None) -> None:
        ctx = context if context is not None else {}
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
            self.emit("node_enter", nodeId=node.id, nodeType=node.type)
            self.emit("node_execute", nodeId=node.id, nodeType=node.type, data=node.data)
            self.emit("node_exit", nodeId=node.id, nodeType=node.type)

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
