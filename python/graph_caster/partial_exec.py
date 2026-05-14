# Copyright GraphCaster. All Rights Reserved.

"""F48 — Partial execution from any node with pinned upstream.

Usage::

    ctx = await build_pinned_context(
        graph=raw_doc,
        start_node="D",
        use_pins=True,
        workspace_root=Path("."),
    )
    # ctx["node_outputs"] = {ancestors: their pinned outputs}
"""

from __future__ import annotations

import copy
import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# DAG helpers
# ---------------------------------------------------------------------------


def _compute_ancestors(start_node: str, edges: list[dict[str, Any]]) -> set[str]:
    """Return all nodes that are strict ancestors of *start_node* (not including it)."""
    # Build reverse adjacency: target -> [sources]
    rev: dict[str, list[str]] = {}
    for e in edges:
        src = str(e.get("source", "")).strip()
        tgt = str(e.get("target", "")).strip()
        if src and tgt:
            rev.setdefault(tgt, []).append(src)

    visited: set[str] = set()
    queue = [start_node]
    while queue:
        node = queue.pop()
        for parent in rev.get(node, []):
            if parent not in visited:
                visited.add(parent)
                queue.append(parent)
    return visited


# ---------------------------------------------------------------------------
# Load pinned outputs from a previous run's events.ndjson
# ---------------------------------------------------------------------------


def _load_outputs_from_run(workspace_root: Path, run_id: str) -> dict[str, Any]:
    """
    Scan ``workspace_root/runs/<graphId>/<runDir>/events.ndjson`` for *run_id* and
    reconstruct node outputs from ``node_finished`` / ``node_exit`` NDJSON events.

    Returns ``{node_id: output_dict}``.  Falls back gracefully: if the file cannot be
    found or parsed, returns ``{}``.
    """
    runs_root = workspace_root / "runs"
    if not runs_root.is_dir():
        return {}

    events_path: Path | None = None
    for graph_dir in sorted(runs_root.iterdir()):
        if not graph_dir.is_dir():
            continue
        for run_dir in sorted(graph_dir.iterdir(), reverse=True):
            if not run_dir.is_dir():
                continue
            summary = run_dir / "run-summary.json"
            if summary.is_file():
                try:
                    data = json.loads(summary.read_text(encoding="utf-8"))
                    if str(data.get("runId", "")).strip() == run_id:
                        events_path = run_dir / "events.ndjson"
                        break
                except (OSError, json.JSONDecodeError):
                    pass
            ev_path = run_dir / "events.ndjson"
            if ev_path.is_file():
                try:
                    with ev_path.open("r", encoding="utf-8") as f:
                        for line in f:
                            line = line.strip()
                            if not line:
                                continue
                            try:
                                obj = json.loads(line)
                            except json.JSONDecodeError:
                                continue
                            if obj.get("type") == "run_started" and str(obj.get("runId", "")).strip() == run_id:
                                events_path = ev_path
                                break
                except OSError:
                    pass
            if events_path is not None:
                break
        if events_path is not None:
            break

    if events_path is None or not events_path.is_file():
        return {}

    outputs: dict[str, Any] = {}
    try:
        with events_path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                ev_type = obj.get("type", "")
                node_id = obj.get("nodeId") or obj.get("node_id")
                if not isinstance(node_id, str) or not node_id:
                    continue
                # Prefer node_outputs_snapshot (carries full output for task nodes)
                if ev_type == "node_outputs_snapshot":
                    payload = obj.get("outputs") or obj.get("payload")
                    if isinstance(payload, dict):
                        outputs[node_id] = copy.deepcopy(payload)
                # Also accept node_exit with usedPin / outputs
                elif ev_type == "node_exit":
                    if node_id not in outputs:
                        out = obj.get("outputs") or obj.get("output")
                        if isinstance(out, dict):
                            outputs[node_id] = copy.deepcopy(out)
    except OSError:
        pass

    return outputs


# ---------------------------------------------------------------------------
# Core function
# ---------------------------------------------------------------------------


async def build_pinned_context(
    *,
    graph: dict[str, Any],
    start_node: str,
    use_pins: bool = True,
    from_run_id: str | None = None,
    workspace_root: Path,
    overrides: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Build a ``node_outputs`` context dict for running a graph from *start_node*.

    Resolution order for each ancestor node:
      1. ``overrides[node_id]`` if provided.
      2. Outputs from the ``from_run_id`` events.ndjson if *from_run_id* is set.
      3. ``node.data.gcPin.payload`` if *use_pins* is True and pin is enabled.
      4. Fallback: ``{}`` with a warning emitted to stderr.

    Parameters
    ----------
    graph:
        Raw GraphDocument dict (as loaded from JSON).
    start_node:
        ID of the node to start execution from.
    use_pins:
        Whether to apply in-document ``gcPin`` payloads for ancestors.
    from_run_id:
        Optional run ID from which to load previous node outputs.
    workspace_root:
        Path to workspace root (contains ``runs/`` and ``graphs/``).
    overrides:
        Explicit per-node output overrides; keys are node IDs, values are output dicts.

    Returns
    -------
    dict
        ``{"node_outputs": {node_id: output_dict, ...}}`` ready to merge into a run context.
    """
    workspace_root = Path(workspace_root).resolve()
    overrides = overrides or {}

    raw_edges = graph.get("edges") or []
    edges = [e for e in raw_edges if isinstance(e, dict)]
    raw_nodes = graph.get("nodes") or []

    # Build {node_id: node_data} index for gcPin lookup
    node_index: dict[str, dict[str, Any]] = {}
    for n in raw_nodes:
        if not isinstance(n, dict):
            continue
        nid = str(n.get("id", "")).strip()
        if nid:
            node_index[nid] = n

    # Walk DAG to find all ancestors of start_node
    ancestors = _compute_ancestors(start_node, edges)

    # Load run outputs if requested
    run_outputs: dict[str, Any] = {}
    if from_run_id:
        run_outputs = _load_outputs_from_run(workspace_root, from_run_id)

    # Build node_outputs for each ancestor
    node_outputs: dict[str, Any] = {}

    for anc_id in ancestors:
        # 1. Override takes priority
        if anc_id in overrides:
            node_outputs[anc_id] = copy.deepcopy(overrides[anc_id])
            continue

        # 2. Previous run outputs
        if from_run_id and anc_id in run_outputs:
            node_outputs[anc_id] = copy.deepcopy(run_outputs[anc_id])
            continue

        # 3. gcPin in the document (only for task nodes)
        if use_pins:
            node_data = node_index.get(anc_id, {})
            node_type = str(node_data.get("type", "")).strip()
            data = node_data.get("data") or {}
            if isinstance(data, dict):
                gc_pin = data.get("gcPin")
                if isinstance(gc_pin, dict) and gc_pin.get("enabled"):
                    payload = gc_pin.get("payload")
                    if isinstance(payload, dict) and payload:
                        node_outputs[anc_id] = copy.deepcopy(payload)
                        continue

        # 4. Fallback with warning
        logger.warning(
            "partial-exec: no pinned output found for ancestor %r; "
            "using empty dict - upstream edge conditions may not evaluate correctly.",
            anc_id,
        )
        node_outputs[anc_id] = {}

    return {"node_outputs": node_outputs}
