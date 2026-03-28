# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from dataclasses import dataclass

from graph_caster.models import Edge, GraphDocument, Node
from graph_caster.validate import merge_mode

EDGE_SOURCE_OUT_ERROR = "out_error"


@dataclass(frozen=True, slots=True)
class ForkBranchPlan:
    node_ids: list[str]
    first_edge_id: str
    merge_id: str

    @property
    def arrive_source(self) -> str:
        return self.node_ids[-1]


def _unconditional_success_edges(doc: GraphDocument, from_id: str, by_id: dict[str, Node]) -> list[Edge]:
    out: list[Edge] = []
    for e in doc.edges:
        if e.source != from_id or e.source_handle == EDGE_SOURCE_OUT_ERROR:
            continue
        tgt = by_id.get(e.target)
        if tgt is None or tgt.type == "comment":
            continue
        c = e.condition
        if c is not None and str(c).strip() != "":
            continue
        out.append(e)
    return out


def barrier_required_predecessors(doc: GraphDocument, merge_id: str, by_id: dict[str, Node]) -> set[str]:
    req: set[str] = set()
    for e in doc.edges:
        if e.target != merge_id or e.source_handle == EDGE_SOURCE_OUT_ERROR:
            continue
        src = by_id.get(e.source)
        if src is None or src.type == "comment":
            continue
        req.add(e.source)
    return req


def build_fork_parallel_plans(
    doc: GraphDocument,
    fork_id: str,
    by_id: dict[str, Node],
) -> tuple[list[ForkBranchPlan] | None, str | None]:
    fork_edges = _unconditional_success_edges(doc, fork_id, by_id)
    if len(fork_edges) < 2:
        return None, None

    plans: list[ForkBranchPlan] = []
    common_merge: str | None = None
    all_nodes: set[str] = set()

    for fe in fork_edges:
        chain: list[str] = []
        cur = fe.target
        visited_local: set[str] = set()
        while True:
            if cur in visited_local:
                return None, "cycle"
            visited_local.add(cur)
            node = by_id.get(cur)
            if node is None:
                return None, "unknown_node"
            if node.type == "merge" and merge_mode(node) == "barrier":
                if not chain:
                    return None, "empty_branch"
                if common_merge is None:
                    common_merge = cur
                elif common_merge != cur:
                    return None, "multiple_merges"
                plans.append(
                    ForkBranchPlan(
                        node_ids=chain,
                        first_edge_id=fe.id,
                        merge_id=cur,
                    )
                )
                for nid in chain:
                    if nid in all_nodes:
                        return None, "shared_node"
                    all_nodes.add(nid)
                break
            if node.type == "fork":
                return None, "nested_fork"
            if node.type == "exit":
                return None, "exit_on_branch"
            chain.append(cur)
            outs = _unconditional_success_edges(doc, cur, by_id)
            if len(outs) != 1:
                return None, "not_linear"
            cur = outs[0].target

    if len(plans) != len(fork_edges) or common_merge is None:
        return None, "incomplete"
    req = barrier_required_predecessors(doc, common_merge, by_id)
    pred_set = {p.arrive_source for p in plans}
    if pred_set != req:
        return None, "barrier_mismatch"
    return plans, None
