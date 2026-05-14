# Copyright GraphCaster. All Rights Reserved.

"""Iteration node handler — map-over-list with optional parallel execution."""

from __future__ import annotations

import hashlib
import json
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

from graph_caster.edge_conditions import eval_edge_condition
from graph_caster.models import Node


MAX_PARALLEL_DEFAULT = 8


def _item_hash(item: Any) -> str:
    try:
        raw = json.dumps(item, sort_keys=True, default=str)
    except Exception:
        raw = repr(item)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def _build_iter_context(ctx: dict[str, Any], item: Any, index: int) -> dict[str, Any]:
    """Return a shallow copy of ctx with $iter injected."""
    child = dict(ctx)
    child["$iter"] = {"item": item, "index": index}
    child["item"] = item
    return child


def execute_iteration_node(
    runner: Any,
    node: Node,
    ctx: dict[str, Any],
) -> None:
    """Execute an `iteration` node: run the subgraph for each item in the list.

    The node collects all body-node ids via ``parentId == node.id``, executes
    them sequentially (or in parallel when ``data.parallel`` is true), then
    writes ``results`` into ``node_outputs``.
    """
    data = dict(node.data) if node.data else {}

    items_key = data.get("itemsKey") or "items"
    parallel: bool = bool(data.get("parallel", False))
    max_parallel: int = int(data.get("maxParallel") or MAX_PARALLEL_DEFAULT)

    items: list[Any] = _resolve_items(node, ctx, items_key, data)

    body_node_ids: list[str] = _collect_body_node_ids(runner, node.id)

    results: list[Any] = []
    if not body_node_ids:
        for i, item in enumerate(items):
            results.append({"index": i, "item": item})
        _store_output(runner, node, ctx, results)
        return

    if parallel and len(items) > 1:
        workers = min(max_parallel, len(items))
        result_slots: list[Any] = [None] * len(items)
        with ThreadPoolExecutor(max_workers=workers) as ex:
            fut_to_idx = {
                ex.submit(_run_body_for_item, runner, body_node_ids, ctx, item, i): i
                for i, item in enumerate(items)
            }
            for fut in as_completed(fut_to_idx):
                idx = fut_to_idx[fut]
                try:
                    result_slots[idx] = fut.result()
                except Exception as exc:
                    result_slots[idx] = {"error": str(exc), "index": idx}
        results = result_slots
    else:
        for i, item in enumerate(items):
            try:
                out = _run_body_for_item(runner, body_node_ids, ctx, item, i)
            except Exception as exc:
                out = {"error": str(exc), "index": i}
            results.append(out)

    _store_output(runner, node, ctx, results)


def _resolve_items(
    node: Node,
    ctx: dict[str, Any],
    items_key: str,
    data: dict[str, Any],
) -> list[Any]:
    outs_map: dict[str, Any] = ctx.get("node_outputs") or {}

    items_expr = data.get("items")
    if items_expr is not None:
        if isinstance(items_expr, list):
            return list(items_expr)
        raw = items_expr
    else:
        raw = outs_map.get(node.id, {})
        if isinstance(raw, dict):
            raw = raw.get(items_key) or raw.get("data", {}).get(items_key)

    if isinstance(raw, list):
        return list(raw)

    for pred_id, pred_out in outs_map.items():
        if isinstance(pred_out, dict):
            candidate = pred_out.get(items_key)
            if isinstance(candidate, list):
                return list(candidate)
            d = pred_out.get("data")
            if isinstance(d, dict):
                candidate = d.get(items_key)
                if isinstance(candidate, list):
                    return list(candidate)

    return []


def _collect_body_node_ids(runner: Any, iteration_node_id: str) -> list[str]:
    ids: list[str] = []
    for n in runner._doc.nodes:
        if n.parentId == iteration_node_id:
            ids.append(n.id)
    return ids


def _run_body_for_item(
    runner: Any,
    body_node_ids: list[str],
    ctx: dict[str, Any],
    item: Any,
    index: int,
) -> Any:
    """Run all body nodes for one iteration item and return the last output."""
    child_ctx = _build_iter_context(ctx, item, index)
    last_output: Any = None
    for nid in body_node_ids:
        node = runner._node_by_id.get(nid)
        if node is None:
            continue
        from graph_caster.runner.node_visits import run_subprocess_task_visit
        from graph_caster.step_queue import StepQueue
        sq = StepQueue(nid)
        run_subprocess_task_visit(runner, node, child_ctx, sq)
        outs = child_ctx.get("node_outputs") or {}
        last_output = outs.get(nid)

    if last_output is not None and isinstance(last_output, dict):
        return last_output
    return {"index": index, "item": item}


def _store_output(
    runner: Any,
    node: Node,
    ctx: dict[str, Any],
    results: list[Any],
) -> None:
    outs_map = ctx.setdefault("node_outputs", {})
    prev = outs_map.get(node.id) or {}
    if not isinstance(prev, dict):
        prev = {}
    prev = dict(prev)
    prev["results"] = results
    outs_map[node.id] = prev
    ctx["last_result"] = results
