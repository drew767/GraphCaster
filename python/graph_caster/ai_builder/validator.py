# Copyright GraphCaster. All Rights Reserved.

"""F91: Graph document validator for AI-generated graphs."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

_SCHEMA_PATH = Path(__file__).parent.parent.parent.parent / "schemas" / "graph-document.schema.json"

# Loop/iteration node types whose body nodes (identified by parentId) are allowed to form
# back-edges within that subgraph, so we exclude them from the global cycle check.
_LOOP_CONTAINER_TYPES = frozenset({"loop", "iteration"})

# Node types that are purely editorial — they do not participate in execution topology.
_EDITOR_ONLY_TYPES = frozenset({"comment", "group"})


def _load_schema() -> dict[str, Any]:
    return json.loads(_SCHEMA_PATH.read_text(encoding="utf-8"))


def validate_graph(graph_json: dict) -> list[str]:
    """Return a list of error messages (empty list means valid).

    Checks performed:
    - jsonschema validation against graph-document.schema.json
    - Exactly one start node
    - At least one exit node
    - No duplicate node ids
    - All edge source/target reference existing node ids
    - No cycles outside loop/iteration parent subgraphs
    """
    errors: list[str] = []

    # 1. JSON Schema validation
    try:
        import jsonschema
        schema = _load_schema()
        validator = jsonschema.Draft202012Validator(schema)
        for err in sorted(validator.iter_errors(graph_json), key=lambda e: list(e.path)):
            errors.append(f"schema: {err.message} (path: {list(err.path)})")
    except ImportError:
        errors.append("jsonschema package not installed; skipping schema validation")
    except Exception as exc:
        errors.append(f"schema validation error: {exc}")

    if not isinstance(graph_json, dict):
        return errors

    nodes = graph_json.get("nodes")
    edges = graph_json.get("edges")
    if not isinstance(nodes, list):
        errors.append("nodes must be a list")
        return errors
    if not isinstance(edges, list):
        errors.append("edges must be a list")
        return errors

    # 2. Unique node ids
    ids: list[str] = []
    seen_ids: set[str] = set()
    for node in nodes:
        if not isinstance(node, dict):
            errors.append("each node must be a JSON object")
            continue
        nid = node.get("id")
        if not isinstance(nid, str) or not nid:
            errors.append(f"node missing valid 'id': {node}")
            continue
        if nid in seen_ids:
            errors.append(f"duplicate node id: {nid!r}")
        else:
            seen_ids.add(nid)
            ids.append(nid)

    # 3. Exactly one start node
    start_nodes = [n for n in nodes if isinstance(n, dict) and n.get("type") == "start"]
    if len(start_nodes) == 0:
        errors.append("graph must have exactly one 'start' node (none found)")
    elif len(start_nodes) > 1:
        errors.append(
            f"graph must have exactly one 'start' node ({len(start_nodes)} found: "
            + ", ".join(n.get("id", "?") for n in start_nodes)
            + ")"
        )

    # 4. At least one exit node
    exit_nodes = [n for n in nodes if isinstance(n, dict) and n.get("type") == "exit"]
    if len(exit_nodes) == 0:
        errors.append("graph must have at least one 'exit' node")

    # 5. Edge source/target reference existing nodes
    for edge in edges:
        if not isinstance(edge, dict):
            errors.append("each edge must be a JSON object")
            continue
        eid = edge.get("id", "<unknown>")
        src = edge.get("source")
        tgt = edge.get("target")
        if src not in seen_ids:
            errors.append(f"edge {eid!r}: source {src!r} does not reference a known node id")
        if tgt not in seen_ids:
            errors.append(f"edge {eid!r}: target {tgt!r} does not reference a known node id")

    # 6. Cycle detection outside loop/iteration subgraphs
    cycle_errors = _check_cycles(nodes, edges, seen_ids)
    errors.extend(cycle_errors)

    return errors


def _check_cycles(nodes: list, edges: list, known_ids: set[str]) -> list[str]:
    """Detect cycles using DFS, skipping edges inside loop/iteration containers."""
    # Build a map of node id -> parentId (for loop/iteration body detection)
    node_parent: dict[str, str | None] = {}
    node_type: dict[str, str] = {}
    for node in nodes:
        if not isinstance(node, dict):
            continue
        nid = node.get("id")
        if not isinstance(nid, str):
            continue
        node_type[nid] = str(node.get("type", ""))
        node_parent[nid] = node.get("parentId")  # may be None

    # Determine loop/iteration container ids
    loop_container_ids: set[str] = {
        nid for nid, t in node_type.items() if t in _LOOP_CONTAINER_TYPES
    }

    # Build adjacency, excluding edges between nodes that share a loop/iteration parent
    adjacency: dict[str, list[str]] = {nid: [] for nid in known_ids}
    for edge in edges:
        if not isinstance(edge, dict):
            continue
        src = edge.get("source")
        tgt = edge.get("target")
        if src not in known_ids or tgt not in known_ids:
            continue
        src_parent = node_parent.get(src)
        tgt_parent = node_parent.get(tgt)
        # Skip edges where both endpoints share a loop/iteration parent container
        if (
            src_parent is not None
            and src_parent == tgt_parent
            and src_parent in loop_container_ids
        ):
            continue
        adjacency[src].append(tgt)

    # DFS-based cycle detection (iterative to avoid Python recursion limits)
    WHITE, GRAY, BLACK = 0, 1, 2
    color: dict[str, int] = {nid: WHITE for nid in known_ids}
    errors: list[str] = []

    for start in list(known_ids):
        if color[start] != WHITE:
            continue
        stack: list[tuple[str, list[str]]] = [(start, list(adjacency.get(start, [])))]
        color[start] = GRAY
        path: list[str] = [start]

        while stack:
            node_id, neighbors = stack[-1]
            if neighbors:
                nb = neighbors.pop(0)
                if color[nb] == GRAY:
                    cycle_start = path.index(nb)
                    cycle = path[cycle_start:] + [nb]
                    errors.append("cycle detected: " + " -> ".join(cycle))
                elif color[nb] == WHITE:
                    color[nb] = GRAY
                    path.append(nb)
                    stack.append((nb, list(adjacency.get(nb, []))))
            else:
                color[node_id] = BLACK
                stack.pop()
                if path and path[-1] == node_id:
                    path.pop()

    return errors
