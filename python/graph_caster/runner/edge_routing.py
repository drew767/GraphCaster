# Copyright GraphCaster. All Rights Reserved.

"""Edge traversal helpers for graph execution (fork branches, conditions, error routes)."""

from __future__ import annotations

from typing import Any

from graph_caster.edge_conditions import eval_edge_condition
from graph_caster.fork_parallel import EDGE_SOURCE_OUT_ERROR
from graph_caster.models import Edge, GraphDocument, Node, is_editor_frame_node_type


def fork_unconditional_edges(doc: GraphDocument, fork_id: str, by_id: dict[str, Node]) -> list[Edge]:
    out: list[Edge] = []
    for e in doc.edges:
        if e.source != fork_id or e.source_handle == EDGE_SOURCE_OUT_ERROR:
            continue
        tgt = by_id.get(e.target)
        if tgt is None or is_editor_frame_node_type(tgt.type):
            continue
        c = e.condition
        if c is not None and str(c).strip() != "":
            continue
        out.append(e)
    return out


def edges_from_source(node_id: str, doc: GraphDocument, *, error_route: bool) -> list[Edge]:
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


def evaluate_next_edge(edges: list[Edge], context: dict[str, Any]) -> tuple[Edge | None, list[Edge]]:
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
