# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import hashlib
import json
from typing import Any

from graph_caster.models import GraphDocument


def _canonical_node_data(data: dict[str, Any]) -> dict[str, Any]:
    return json.loads(json.dumps(data, sort_keys=True, default=str))


def graph_document_revision(doc: GraphDocument) -> str:
    nodes_payload: list[dict[str, Any]] = []
    for n in sorted(doc.nodes, key=lambda x: x.id):
        nodes_payload.append(
            {
                "id": n.id,
                "type": n.type,
                "data": _canonical_node_data(dict(n.data)),
            }
        )
    edges_payload: list[dict[str, Any]] = []
    for e in sorted(
        doc.edges,
        key=lambda x: (x.source, x.target, x.id, x.source_handle, x.target_handle, x.condition or ""),
    ):
        edges_payload.append(
            {
                "id": e.id,
                "source": e.source,
                "source_handle": e.source_handle,
                "target": e.target,
                "target_handle": e.target_handle,
                "condition": e.condition,
            }
        )
    blob = {
        "edges": edges_payload,
        "graph_id": doc.graph_id,
        "nodes": nodes_payload,
        "schema_version": doc.schema_version,
    }
    raw = json.dumps(blob, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()
