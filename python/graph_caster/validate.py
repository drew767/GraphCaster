# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from graph_caster.models import GraphDocument


class GraphStructureError(ValueError):
    pass


def validate_graph_structure(doc: GraphDocument) -> str:
    """
    Returns the start node id if the document is structurally valid.
    Raises GraphStructureError otherwise.
    """
    starts = [n for n in doc.nodes if n.type == "start"]
    if len(starts) == 0:
        raise GraphStructureError("graph must have exactly one node of type 'start', got none")
    if len(starts) > 1:
        raise GraphStructureError(f"graph must have exactly one node of type 'start', got {len(starts)}")
    start_id = starts[0].id
    for e in doc.edges:
        if e.target == start_id:
            raise GraphStructureError(f"start node '{start_id}' must not have incoming edges (edge '{e.id}' targets it)")
    gid = str(doc.graph_id).strip() if doc.graph_id else ""
    if not gid or gid == "default":
        raise GraphStructureError("meta.graphId (or top-level graphId) must be set to a non-empty unique id")
    return start_id
