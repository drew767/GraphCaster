# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

# Non-executable canvas frames (editor-only); runner and static graph checks skip these like edges.
EDITOR_FRAME_NODE_TYPES: frozenset[str] = frozenset({"comment", "group"})


def is_editor_frame_node_type(node_type: str) -> bool:
    return node_type in EDITOR_FRAME_NODE_TYPES


def _normalize_edge_condition(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    return None


def _graph_id_from_raw(meta: dict[str, Any], raw: dict[str, Any]) -> str:
    for candidate in (meta.get("graphId"), raw.get("graphId")):
        if candidate is None:
            continue
        s = str(candidate).strip()
        if s:
            return s
    return "default"


def _edge_handle_from_edge(e: dict[str, Any], camel: str, snake: str, fallback: str) -> str:
    for key in (camel, snake):
        if key not in e:
            continue
        v = e[key]
        if v is None or v is False or v == 0:
            continue
        if isinstance(v, str):
            t = v.strip()
            if t == "":
                continue
            return t
        if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
            continue
        if isinstance(v, (int, float)):
            return str(v)
        if v is True:
            return "True"
    return fallback


@dataclass
class Node:
    id: str
    type: str
    position: dict[str, float]
    data: dict[str, Any] = field(default_factory=dict)


@dataclass
class Edge:
    id: str
    source: str
    source_handle: str
    target: str
    target_handle: str
    condition: str | None = None
    data: dict[str, Any] | None = None


@dataclass
class GraphDocument:
    schema_version: int
    graph_id: str
    nodes: list[Node]
    edges: list[Edge]
    viewport: dict[str, Any] | None = None
    author: str | None = None
    title: str | None = None
    #: Workspace-level variables merged into ``ctx["run_variables"]`` (also ``meta.variables`` / root ``variables`` in JSON).
    variables: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> GraphDocument:
        if not isinstance(raw, dict):
            raise ValueError("document root must be a JSON object")
        meta_raw = raw.get("meta")
        if meta_raw is None:
            meta: dict[str, Any] = {}
        elif isinstance(meta_raw, dict):
            meta = meta_raw
        else:
            raise ValueError("'meta' must be a JSON object if present")
        nodes_raw = raw.get("nodes")
        if nodes_raw is None:
            nodes_in: list[Any] = []
        elif not isinstance(nodes_raw, list):
            raise ValueError("'nodes' must be an array")
        else:
            nodes_in = nodes_raw
        edges_raw = raw.get("edges")
        if edges_raw is None:
            edges_in: list[Any] = []
        elif not isinstance(edges_raw, list):
            raise ValueError("'edges' must be an array")
        else:
            edges_in = edges_raw
        nodes: list[Node] = []
        for i, n in enumerate(nodes_in):
            if not isinstance(n, dict):
                raise ValueError(f"nodes[{i}] must be a JSON object")
            nid = n.get("id")
            if not isinstance(nid, str) or not nid.strip():
                raise ValueError(f"nodes[{i}] must have a non-empty string 'id'")
            pos_raw = n.get("position")
            pos = pos_raw if isinstance(pos_raw, dict) else {"x": 0.0, "y": 0.0}
            t_raw = n.get("type")
            if t_raw is None:
                node_type = "unknown"
            else:
                node_type = str(t_raw).strip() or "unknown"
            data_raw = n.get("data")
            if data_raw is None:
                data_obj: dict[str, Any] = {}
            elif isinstance(data_raw, dict):
                data_obj = dict(data_raw)
            else:
                raise ValueError(f"nodes[{i}].data must be a JSON object")
            nodes.append(
                Node(
                    id=nid.strip(),
                    type=node_type,
                    position={"x": float(pos.get("x", 0)), "y": float(pos.get("y", 0))},
                    data=data_obj,
                )
            )
        edges: list[Edge] = []
        for i, e in enumerate(edges_in):
            if not isinstance(e, dict):
                raise ValueError(f"edges[{i}] must be a JSON object")
            eid = e.get("id")
            if not isinstance(eid, str) or not eid.strip():
                raise ValueError(f"edges[{i}] must have a non-empty string 'id'")
            src = e.get("source")
            tgt = e.get("target")
            if not isinstance(src, str) or not src.strip():
                raise ValueError(f"edges[{i}] must have a non-empty string 'source'")
            if not isinstance(tgt, str) or not tgt.strip():
                raise ValueError(f"edges[{i}] must have a non-empty string 'target'")
            ed_raw = e.get("data")
            if ed_raw is None:
                edge_extra: dict[str, Any] | None = None
            elif isinstance(ed_raw, dict):
                edge_extra = dict(ed_raw)
            else:
                raise ValueError(f"edges[{i}].data must be a JSON object if present")
            edges.append(
                Edge(
                    id=eid.strip(),
                    source=src.strip(),
                    source_handle=_edge_handle_from_edge(e, "sourceHandle", "source_handle", "out_default"),
                    target=tgt.strip(),
                    target_handle=_edge_handle_from_edge(e, "targetHandle", "target_handle", "in_default"),
                    condition=_normalize_edge_condition(e.get("condition")),
                    data=edge_extra,
                )
            )
        schema_src: Any = meta.get("schemaVersion")
        if schema_src is None:
            schema_src = raw.get("schemaVersion")
        if schema_src is None:
            schema_version = 1
        else:
            try:
                schema_version = int(schema_src)
            except (TypeError, ValueError) as err:
                raise ValueError("schemaVersion must be an integer") from err
        graph_id = _graph_id_from_raw(meta, raw)
        author = meta.get("author")
        title = meta.get("title")
        if author is not None:
            author = str(author)
        if title is not None:
            title = str(title)
        variables_raw = meta.get("variables")
        if variables_raw is None:
            variables_raw = raw.get("variables")
        variables_out: dict[str, Any] = {}
        if isinstance(variables_raw, dict):
            variables_out = dict(variables_raw)
        viewport_raw = raw.get("viewport")
        if viewport_raw is None:
            viewport_out: dict[str, Any] | None = None
        elif isinstance(viewport_raw, dict):
            viewport_out = dict(viewport_raw)
        else:
            raise ValueError("'viewport' must be a JSON object if present")
        return cls(
            schema_version=schema_version,
            graph_id=graph_id,
            nodes=nodes,
            edges=edges,
            viewport=viewport_out,
            author=author,
            title=title,
            variables=variables_out,
        )
