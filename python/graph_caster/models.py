# Copyright Aura. All Rights Reserved.

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class PinSpec:
    id: str
    kind: str


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


@dataclass
class GraphDocument:
    schema_version: int
    graph_id: str
    nodes: list[Node]
    edges: list[Edge]
    viewport: dict[str, Any] | None = None

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> GraphDocument:
        meta = raw.get("meta") or {}
        nodes_in = raw.get("nodes") or []
        edges_in = raw.get("edges") or []
        nodes: list[Node] = []
        for n in nodes_in:
            pos = n.get("position") or {"x": 0.0, "y": 0.0}
            nodes.append(
                Node(
                    id=str(n["id"]),
                    type=str(n["type"]),
                    position={"x": float(pos.get("x", 0)), "y": float(pos.get("y", 0))},
                    data=dict(n.get("data") or {}),
                )
            )
        edges: list[Edge] = []
        for e in edges_in:
            cond = e.get("condition")
            edges.append(
                Edge(
                    id=str(e["id"]),
                    source=str(e["source"]),
                    source_handle=str(e.get("sourceHandle") or e.get("source_handle") or "out"),
                    target=str(e["target"]),
                    target_handle=str(e.get("targetHandle") or e.get("target_handle") or "in"),
                    condition=str(cond) if cond is not None else None,
                )
            )
        return cls(
            schema_version=int(meta.get("schemaVersion") or raw.get("schemaVersion") or 1),
            graph_id=str(meta.get("graphId") or raw.get("graphId") or "default"),
            nodes=nodes,
            edges=edges,
            viewport=raw.get("viewport"),
        )
