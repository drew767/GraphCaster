# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from collections.abc import Mapping, Sequence
from pathlib import Path

from graph_caster.models import Node
from graph_caster.workspace import load_graph_documents_index

_WHITE, _GRAY, _BLACK = 0, 1, 2


def _ref_targets_from_node(node: Node) -> list[str]:
    if node.type != "graph_ref":
        return []
    tid = node.data.get("targetGraphId") or node.data.get("graphId")
    if tid is None:
        return []
    t = str(tid).strip()
    if not t:
        return []
    return [t]


def build_workspace_graph_ref_adjacency(graphs_root: Path) -> dict[str, list[str]]:
    index = load_graph_documents_index(graphs_root)
    adj: dict[str, list[str]] = {gid: [] for gid in index}
    for gid, (_path, doc) in index.items():
        seen: set[str] = set()
        for node in doc.nodes:
            for t in _ref_targets_from_node(node):
                if t not in seen:
                    seen.add(t)
                    adj[gid].append(t)
    return adj


def _vertex_set(adj: Mapping[str, Sequence[str]]) -> set[str]:
    s = set(adj.keys())
    for targets in adj.values():
        s.update(targets)
    return s


def _canon_rotate_cycle(cycle: list[str]) -> list[str]:
    if len(cycle) <= 1:
        return cycle
    n = len(cycle)
    best_rot: list[str] | None = None
    best_key: tuple[str, ...] | None = None
    for i in range(n):
        rot = cycle[i:] + cycle[:i]
        key = tuple(rot)
        if best_key is None or key < best_key:
            best_key = key
            best_rot = rot
    return list(best_rot) if best_rot is not None else cycle


def find_workspace_graph_ref_cycle(adj: Mapping[str, Sequence[str]]) -> list[str] | None:
    color: dict[str, int] = {}
    stack_pos: dict[str, int] = {}
    found: list[str] | None = None

    def dfs(u: str, stack: list[str]) -> None:
        nonlocal found
        if found is not None:
            return
        color[u] = _GRAY
        stack.append(u)
        stack_pos[u] = len(stack) - 1
        for v in adj.get(u, ()):
            if found is not None:
                break
            c = color.get(v, _WHITE)
            if c == _WHITE:
                dfs(v, stack)
            elif c == _GRAY:
                i = stack_pos.get(v)
                if i is not None:
                    found = _canon_rotate_cycle(stack[i:])
        stack.pop()
        del stack_pos[u]
        color[u] = _BLACK

    for v in sorted(_vertex_set(adj)):
        if color.get(v, _WHITE) == _WHITE:
            dfs(v, [])
            if found is not None:
                break
    return found
