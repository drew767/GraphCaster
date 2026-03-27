# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import copy
from typing import Any

from graph_caster.models import GraphDocument, Node

_SNAPSHOT_STR_MAX = 4000


def gc_pin_dict(node: Node) -> dict[str, Any] | None:
    p = node.data.get("gcPin")
    return p if isinstance(p, dict) else None


def gc_pin_enabled(node: Node) -> bool:
    d = gc_pin_dict(node)
    return bool(d and d.get("enabled"))


def gc_pin_payload(node: Node) -> dict[str, Any] | None:
    d = gc_pin_dict(node)
    if not d:
        return None
    pl = d.get("payload")
    return pl if isinstance(pl, dict) else None


def gc_pin_valid_for_short_circuit(node: Node) -> bool:
    if node.type != "task":
        return False
    if not gc_pin_enabled(node):
        return False
    pl = gc_pin_payload(node)
    if not pl:
        return False
    pr = pl.get("processResult")
    return isinstance(pr, dict)


def merged_process_result_for_pin_short_circuit(outs_slice: Any) -> dict[str, Any] | None:
    if not isinstance(outs_slice, dict):
        return None
    pr = outs_slice.get("processResult")
    if not isinstance(pr, dict) or len(pr) == 0:
        return None
    return pr


def last_result_from_process_result(pr: Any) -> bool:
    if not isinstance(pr, dict):
        return True
    if len(pr) == 0:
        return False
    if "success" in pr:
        return bool(pr.get("success"))
    ec = pr.get("exitCode")
    if isinstance(ec, int):
        return ec == 0
    if isinstance(ec, bool):
        return ec
    return True


def apply_gc_pins_to_document_context(doc: GraphDocument, ctx: dict[str, Any]) -> None:
    outs = ctx.setdefault("node_outputs", {})
    for n in doc.nodes:
        if n.type != "task":
            continue
        if not gc_pin_enabled(n):
            continue
        pl = gc_pin_payload(n)
        if not isinstance(pl, dict) or not pl:
            continue
        if n.id in outs:
            continue
        outs[n.id] = copy.deepcopy(pl)


def snapshot_for_pin_event(outs_slice: dict[str, Any]) -> dict[str, Any]:
    o = copy.deepcopy(outs_slice)

    def trim_str(s: str) -> str:
        if len(s) <= _SNAPSHOT_STR_MAX:
            return s
        return s[-_SNAPSHOT_STR_MAX:]

    pr = o.get("processResult")
    if isinstance(pr, dict):
        for key in ("stdout", "stderr", "stdoutFull", "stderrFull", "stdoutTail", "stderrTail"):
            v = pr.get(key)
            if isinstance(v, str):
                pr[key] = trim_str(v)
    return o


def find_gc_pin_empty_payload_warnings(doc: GraphDocument) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for n in doc.nodes:
        if n.type != "task":
            continue
        d = gc_pin_dict(n)
        if not d or not d.get("enabled"):
            continue
        pl = d.get("payload")
        if not isinstance(pl, dict) or len(pl) == 0:
            out.append({"nodeId": n.id})
    return out
