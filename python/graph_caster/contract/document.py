# Copyright GraphCaster. All Rights Reserved.
# Authoritative source: schemas/graph-document.schema.json (v1.20)
#
# This module mirrors the JSON Schema shape as pydantic models. It is a
# hand-written mirror until scripts/codegen.sh (planned) wires
# datamodel-code-generator. The schema remains the single source of truth:
# any drift between this file and the schema is a bug.
#
# Forward-compatibility: every model sets `extra="allow"` so unknown fields
# round-trip unchanged. This matches `additionalProperties: true` in the
# schema and the existing UI behaviour.
#
# Public API:
#   Document  - top-level graph document
#   Node      - graph node (id, type, position, data, mode?, parentId?)
#   Edge      - graph edge with both camelCase (canonical) and snake_case
#               legacy handle aliases preserved verbatim
#   Viewport  - canvas viewport { x, y, zoom }
#   Meta      - document meta block (schemaVersion, graphId, title, author)

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class _Contract(BaseModel):
    """Common base: forward-compat (`extra=allow`) + accept aliases."""

    model_config = ConfigDict(
        extra="allow",
        populate_by_name=True,
    )


class Viewport(_Contract):
    x: float | None = None
    y: float | None = None
    zoom: float | None = None


class Meta(_Contract):
    schemaVersion: int | None = None
    graphId: str | None = None
    title: str | None = None
    author: str | None = None


class Node(_Contract):
    id: str
    type: str
    position: dict[str, Any] = Field(default_factory=lambda: {"x": 0.0, "y": 0.0})
    data: dict[str, Any] = Field(default_factory=dict)
    # Execution mode. Mirrors models.NODE_MODES: normal|bypass|mute|disabled.
    # Optional in schema, defaults applied at the legacy from_dict layer.
    mode: str | None = None
    # Optional parent node id for group/frame membership.
    parentId: str | None = None


class Edge(_Contract):
    id: str
    source: str
    target: str
    # camelCase = canonical (schema); snake_case retained as forward-compat
    # alias since old graphs/ on disk may still use these keys until a
    # migration scrubs them. parseDocument.ts has the matching JS fallback.
    sourceHandle: str | None = None
    targetHandle: str | None = None
    source_handle: str | None = None
    target_handle: str | None = None
    condition: str | None = None
    data: dict[str, Any] | None = None


class Document(_Contract):
    schemaVersion: int | None = None
    graphId: str | None = None
    meta: Meta | None = None
    viewport: Viewport | None = None
    inputs: Any | None = None
    outputs: Any | None = None
    nodes: list[Node] = Field(default_factory=list)
    edges: list[Edge] = Field(default_factory=list)
