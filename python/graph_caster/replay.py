# Copyright GraphCaster. All Rights Reserved.

"""F102 — Deterministic trace replay.

Usage:
    plan = await ReplayManager(workspace).build_plan(run_id, start_from="nodeC")
    new_run_id = await ReplayManager(workspace).execute(plan)
"""

from __future__ import annotations

import copy
import json
import logging
import os
import sys
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from graph_caster.history.events import EventLogReader, EventType

_LOG = logging.getLogger(__name__)


# Node kinds whose execution has externally-visible side effects (network calls,
# webhooks, billable LLM/MCP/Composio invocations, arbitrary code). Replaying these
# without an explicit opt-in risks duplicate charges and duplicate user-facing events.
NON_IDEMPOTENT_NODE_KINDS: frozenset[str] = frozenset(
    {
        "http_request",
        "api_call",
        "llm",
        "llm_agent",
        "agent",
        "mcp_tool",
        "code",
        "python_code",
        "composio_action",
        "openapi_tool",
        "task",
        "trigger_webhook",
    }
)


# Operator escape hatch: set GC_REPLAY_FORCE=1 to acknowledge the duplicate-
# side-effect risk for an entire process (CI, post-incident reruns). Equivalent
# to passing ``allow_non_idempotent=True`` / ``force=True`` on every call.
REPLAY_FORCE_ENV = "GC_REPLAY_FORCE"


def _replay_force_from_env() -> bool:
    raw = os.environ.get(REPLAY_FORCE_ENV, "").strip().lower()
    return raw in ("1", "true", "yes", "on")


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------


@dataclass
class ReplayPlan:
    run_id: str
    graph_id: str
    graph_version: int | None
    start_from_node: str
    pinned_outputs: dict[str, dict]
    replayed_nodes: list[str]
    skipped_nodes: list[str]

    def to_dict(self) -> dict[str, Any]:
        return {
            "runId": self.run_id,
            "graphId": self.graph_id,
            "graphVersion": self.graph_version,
            "startFromNode": self.start_from_node,
            "pinnedOutputs": self.pinned_outputs,
            "replayedNodes": self.replayed_nodes,
            "skippedNodes": self.skipped_nodes,
        }


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class ReplayError(Exception):
    """Raised when a replay cannot be planned or executed."""


class ReplayUnsafeError(ReplayError):
    """Raised when a replay would re-execute non-idempotent nodes without explicit opt-in.

    Attributes:
        risky_node_ids: Node IDs whose ``type`` is in ``NON_IDEMPOTENT_NODE_KINDS``
            and would be re-executed by this replay.
    """

    def __init__(self, risky_node_ids: list[str]) -> None:
        self.risky_node_ids = list(risky_node_ids)
        names = ", ".join(self.risky_node_ids) if self.risky_node_ids else "(none)"
        super().__init__(
            "Replay would re-execute non-idempotent nodes "
            f"[{names}] which may duplicate external side effects "
            "(HTTP requests, LLM/MCP calls, webhooks, billable actions). "
            "Pass force=True (or allow_non_idempotent=True), "
            f"or set {REPLAY_FORCE_ENV}=1 to proceed."
        )


# Spec-named alias for callers that prefer the more descriptive name. Same class,
# so ``except ReplayUnsafeError`` and ``except ReplayWouldDuplicateSideEffects``
# both catch the same instance.
ReplayWouldDuplicateSideEffects = ReplayUnsafeError


def analyze_replay_safety(
    doc: dict[str, Any],
    *,
    from_node_id: str | None = None,
) -> list[str]:
    """Return node IDs reachable from ``from_node_id`` whose ``type`` has side effects.

    Walks the directed graph from ``from_node_id`` (or the start node, defined as a node
    whose ``type`` is ``"start"`` or, failing that, any node with no incoming edge).
    Returns IDs of reachable nodes whose ``type`` (or ``kind``) is in
    :data:`NON_IDEMPOTENT_NODE_KINDS`, preserving source order.
    """
    raw_nodes = doc.get("nodes") or []
    raw_edges = doc.get("edges") or []
    nodes_by_id: dict[str, dict[str, Any]] = {}
    for n in raw_nodes:
        if isinstance(n, dict):
            nid = str(n.get("id", "")).strip()
            if nid:
                nodes_by_id[nid] = n

    edges = [e for e in raw_edges if isinstance(e, dict)]

    start = from_node_id
    if not start:
        # Prefer an explicit "start" node; else the first node without an incoming edge.
        incoming: set[str] = set()
        for e in edges:
            tgt = str(e.get("target", "")).strip()
            if tgt:
                incoming.add(tgt)
        for n in raw_nodes:
            if isinstance(n, dict) and str(n.get("type", "")).strip() == "start":
                start = str(n.get("id", "")).strip() or None
                break
        if not start:
            for n in raw_nodes:
                if not isinstance(n, dict):
                    continue
                nid = str(n.get("id", "")).strip()
                if nid and nid not in incoming:
                    start = nid
                    break

    if not start or start not in nodes_by_id:
        return []

    reachable = _compute_downstream(start, edges)

    risky: list[str] = []
    for n in raw_nodes:
        if not isinstance(n, dict):
            continue
        nid = str(n.get("id", "")).strip()
        if not nid or nid not in reachable:
            continue
        kind = str(n.get("type") or n.get("kind") or "").strip()
        if kind in NON_IDEMPOTENT_NODE_KINDS:
            risky.append(nid)
    return risky


# ---------------------------------------------------------------------------
# Helpers: scan runs/ directory
# ---------------------------------------------------------------------------


def _find_run_dir(workspace_root: Path, run_id: str) -> tuple[Path, str] | None:
    """
    Scan ``workspace_root/runs/<graphId>/<runDir>/run-summary.json`` for a matching
    run_id.  Returns ``(run_dir_path, graph_id)`` or ``None``.
    """
    runs_root = workspace_root / "runs"
    if not runs_root.is_dir():
        return None
    for graph_dir in sorted(runs_root.iterdir()):
        if not graph_dir.is_dir():
            continue
        for run_dir in sorted(graph_dir.iterdir(), reverse=True):
            if not run_dir.is_dir():
                continue
            # Try run-summary.json first
            summary_path = run_dir / "run-summary.json"
            if summary_path.is_file():
                try:
                    data = json.loads(summary_path.read_text(encoding="utf-8"))
                    if str(data.get("runId", "")).strip() == run_id:
                        return run_dir, graph_dir.name
                except (OSError, json.JSONDecodeError):
                    pass
            # Fallback: scan events.ndjson for run_started event with matching runId
            events_path = run_dir / "events.ndjson"
            if events_path.is_file():
                try:
                    for ev in EventLogReader(events_path).read_by_type(
                        [EventType.RUN_STARTED]
                    ):
                        if ev.run_id == run_id:
                            return run_dir, graph_dir.name
                        break  # only check first run_started
                except OSError:
                    pass
    return None


# ---------------------------------------------------------------------------
# Helpers: reconstruct node outputs from events
# ---------------------------------------------------------------------------


def _reconstruct_node_outputs(events_path: Path) -> dict[str, Any]:
    """Return ``{node_id: output}`` for all nodes that emitted a successful STEP_FINISHED."""
    outputs: dict[str, Any] = {}
    reader = EventLogReader(events_path)
    for ev in reader.read_all():
        if ev.type == EventType.STEP_FINISHED:
            node_id = ev.data.get("nodeId")
            ok = bool(ev.data.get("ok", True))
            output = ev.data.get("output")
            if isinstance(node_id, str) and node_id and ok and output is not None:
                outputs[node_id] = output
    return outputs


def _find_first_incomplete_node(
    events_path: Path, all_node_ids: set[str]
) -> str | None:
    """
    Return the first node that started but never finished successfully, or that
    failed/was cancelled.  Scans events in order; picks the earliest by start index.
    """
    started: dict[str, int] = {}
    failed: set[str] = set()
    succeeded: set[str] = set()
    reader = EventLogReader(events_path)
    for ev in reader.read_all():
        node_id = ev.data.get("nodeId")
        if not isinstance(node_id, str) or not node_id:
            continue
        if ev.type == EventType.STEP_STARTED:
            if node_id not in started:
                started[node_id] = ev.index
        elif ev.type == EventType.STEP_FINISHED:
            ok = bool(ev.data.get("ok", True))
            if ok:
                succeeded.add(node_id)
            else:
                failed.add(node_id)

    # Nodes that started but were not marked successful: failed or incomplete
    incomplete = (set(started.keys()) - succeeded) | failed
    if not incomplete:
        return None
    # Return the one that started earliest
    return min(incomplete, key=lambda nid: started.get(nid, 9_999_999))


# ---------------------------------------------------------------------------
# Helpers: DAG traversal
# ---------------------------------------------------------------------------


def _load_graph_doc(workspace_root: Path, graph_id: str) -> dict[str, Any] | None:
    """Load the draft graph JSON for graph_id from workspace_root/graphs/."""
    graphs_dir = workspace_root / "graphs"
    if not graphs_dir.is_dir():
        return None
    for p in graphs_dir.iterdir():
        if p.suffix != ".json":
            continue
        try:
            raw = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        meta = raw.get("meta") or {}
        gid = meta.get("graphId") or raw.get("graphId") or ""
        if str(gid).strip() == graph_id:
            return raw
    return None


def _compute_downstream(start_node: str, edges: list[dict[str, Any]]) -> set[str]:
    """
    Return the set of nodes reachable from ``start_node`` following directed edges
    (including ``start_node`` itself).
    """
    adjacency: dict[str, list[str]] = {}
    for e in edges:
        src = str(e.get("source", "")).strip()
        tgt = str(e.get("target", "")).strip()
        if src and tgt:
            adjacency.setdefault(src, []).append(tgt)

    visited: set[str] = set()
    queue = [start_node]
    while queue:
        node = queue.pop()
        if node in visited:
            continue
        visited.add(node)
        for nxt in adjacency.get(node, []):
            if nxt not in visited:
                queue.append(nxt)
    return visited


# ---------------------------------------------------------------------------
# ReplayManager
# ---------------------------------------------------------------------------


class ReplayManager:
    """Build and execute deterministic replay plans."""

    def __init__(
        self,
        workspace_root: Path,
        *,
        runner_factory: Callable[..., Any] | None = None,
    ) -> None:
        """
        Parameters
        ----------
        workspace_root:
            Directory containing ``graphs/`` and ``runs/`` sub-trees.
        runner_factory:
            Optional override for the runner used in :meth:`execute`.
            Signature: ``factory(doc, *, sink, host) -> runner_with_run_from()``.
            Defaults to :class:`graph_caster.runner.GraphRunner`.
        """
        self.workspace_root = Path(workspace_root).resolve()
        self._runner_factory = runner_factory

    # ------------------------------------------------------------------
    # build_plan
    # ------------------------------------------------------------------

    async def build_plan(
        self,
        run_id: str,
        *,
        start_from: str | None = None,
        override_inputs: dict | None = None,
    ) -> ReplayPlan:
        """
        Construct a :class:`ReplayPlan` for re-executing a previous run.

        Steps:
        1. Locate the run directory by scanning ``runs/<graphId>/<runDir>/``.
        2. Read ``events.ndjson``; reconstruct per-node outputs for completed nodes.
        3. Determine ``start_from`` (explicit or auto-detect first failure).
        4. Compute the downstream subgraph via DAG walk.
        5. ``skipped_nodes`` = nodes with successful outputs not in downstream.
        6. ``pinned_outputs`` = collected from skipped_nodes.
        7. Apply ``override_inputs`` to pinned_outputs.
        """
        found = _find_run_dir(self.workspace_root, run_id)
        if found is None:
            raise ReplayError(f"Run not found in workspace: {run_id!r}")
        run_dir, graph_id = found

        events_path = run_dir / "events.ndjson"
        if not events_path.is_file():
            raise ReplayError(f"No events.ndjson for run: {run_id!r}")

        # Reconstruct node outputs from events
        node_outputs = _reconstruct_node_outputs(events_path)

        # Load the graph document to obtain node ids and edges
        raw_doc = _load_graph_doc(self.workspace_root, graph_id)
        edges: list[dict[str, Any]] = []
        all_node_ids: set[str] = set()
        graph_version: int | None = None
        if raw_doc is not None:
            meta = raw_doc.get("meta") or {}
            schema_v = meta.get("schemaVersion") or raw_doc.get("schemaVersion")
            if isinstance(schema_v, int):
                graph_version = schema_v
            raw_nodes = raw_doc.get("nodes") or []
            all_node_ids = {
                str(n.get("id", "")).strip()
                for n in raw_nodes
                if isinstance(n, dict) and n.get("id")
            }
            raw_edges = raw_doc.get("edges") or []
            edges = [e for e in raw_edges if isinstance(e, dict)]

        # Determine start_from
        if start_from is None:
            start_from = _find_first_incomplete_node(events_path, all_node_ids)
            if start_from is None:
                # All nodes finished; replay from first node that had output
                if node_outputs:
                    start_from = next(iter(node_outputs))
                elif all_node_ids:
                    start_from = next(iter(sorted(all_node_ids)))
                else:
                    raise ReplayError(
                        "Cannot auto-detect start node: no incomplete nodes found and no outputs"
                    )

        if not start_from:
            raise ReplayError("start_from node id must not be empty")

        # Compute downstream nodes (including start_from itself)
        downstream = _compute_downstream(start_from, edges)

        # Determine replayed vs skipped
        replayed_nodes = sorted(downstream)
        skipped_nodes = sorted(
            nid for nid in node_outputs if nid not in downstream
        )

        # Build pinned_outputs from upstream (skipped) nodes that had outputs
        pinned_outputs: dict[str, dict] = {}
        for nid in skipped_nodes:
            out = node_outputs.get(nid)
            if isinstance(out, dict):
                pinned_outputs[nid] = copy.deepcopy(out)
            elif out is not None:
                pinned_outputs[nid] = {"value": copy.deepcopy(out)}

        # Apply overrides to pinned_outputs
        if override_inputs:
            for key, value in override_inputs.items():
                if "." in key:
                    node_id, output_key = key.split(".", 1)
                    pinned_outputs.setdefault(node_id, {})[output_key] = value
                    if node_id not in skipped_nodes and node_id not in downstream:
                        skipped_nodes = sorted(set(skipped_nodes) | {node_id})

        return ReplayPlan(
            run_id=run_id,
            graph_id=graph_id,
            graph_version=graph_version,
            start_from_node=start_from,
            pinned_outputs=pinned_outputs,
            replayed_nodes=replayed_nodes,
            skipped_nodes=skipped_nodes,
        )

    # ------------------------------------------------------------------
    # execute
    # ------------------------------------------------------------------

    async def execute(
        self,
        plan: ReplayPlan,
        *,
        override_inputs: dict | None = None,
        allow_non_idempotent: bool = False,
        force: bool = False,
    ) -> str:
        """
        Execute the replay plan.  Returns the new run_id.

        Uses the existing ``run_from`` runner entry-point (F40 semantics):
        pre-populates ``ctx["node_outputs"]`` with ``plan.pinned_outputs``, then
        calls ``runner.run_from(plan.start_from_node, context=ctx)``.

        Emits ``replay_planned``, ``replay_started``, and ``node_pinned_from_replay``
        events.  Writes ``replay-of.json`` into the new run's artifact directory.

        Safety
        ------
        By default any node in :data:`NON_IDEMPOTENT_NODE_KINDS` that would be
        re-executed raises :class:`ReplayUnsafeError` (alias:
        :class:`ReplayWouldDuplicateSideEffects`). To proceed anyway, any of:

        * ``force=True`` — spec-named per-call opt-in.
        * ``allow_non_idempotent=True`` — historical alias, same behaviour.
        * ``GC_REPLAY_FORCE=1`` env — process-wide opt-in for CI / batch replays.

        With any override active, a WARNING is logged enumerating which non-
        idempotent nodes are about to be re-executed before the runner is invoked.
        """
        import asyncio

        raw_doc = _load_graph_doc(self.workspace_root, plan.graph_id)
        if raw_doc is None:
            raise ReplayError(
                f"Graph document not found for graph_id: {plan.graph_id!r}"
            )

        risky = analyze_replay_safety(raw_doc, from_node_id=plan.start_from_node)
        env_force = _replay_force_from_env()
        override = bool(allow_non_idempotent or force or env_force)
        if risky:
            if not override:
                raise ReplayUnsafeError(risky)
            reason = (
                "GC_REPLAY_FORCE=1"
                if env_force and not (allow_non_idempotent or force)
                else ("force=True" if force else "allow_non_idempotent=True")
            )
            _LOG.warning(
                "Replay will re-execute non-idempotent nodes %s (%s); "
                "external side effects (HTTP, LLM, MCP, billable actions) may duplicate.",
                risky,
                reason,
            )

        from graph_caster.models import GraphDocument
        from graph_caster.run_event_sink import (
            NdjsonStdoutSink,
            TeeRunEventSink,
            NdjsonAppendFileSink,
        )
        from graph_caster.host_context import RunHostContext
        from graph_caster.artifacts import create_root_run_artifact_dir, write_run_summary
        from graph_caster.runner import GraphRunner

        try:
            doc = GraphDocument.from_dict(raw_doc)
        except ValueError as exc:
            raise ReplayError(f"Invalid graph document: {exc}") from exc

        new_run_id = str(uuid.uuid4())

        # Apply override_inputs on top of pinned_outputs
        effective_pinned: dict[str, Any] = copy.deepcopy(plan.pinned_outputs)
        if override_inputs:
            for key, value in override_inputs.items():
                if "." in key:
                    node_id, output_key = key.split(".", 1)
                    effective_pinned.setdefault(node_id, {})[output_key] = value

        # Create artifact dir for new run
        run_dir = create_root_run_artifact_dir(self.workspace_root, plan.graph_id)

        events_path = run_dir / "events.ndjson"
        file_sink = NdjsonAppendFileSink(events_path)
        stdout_sink = NdjsonStdoutSink(sys.stdout.write, sys.stdout.flush)
        # TeeRunEventSink(a=primary, b=best-effort)
        sink = TeeRunEventSink(stdout_sink, file_sink)

        host = RunHostContext(
            graphs_root=self.workspace_root / "graphs",
            artifacts_base=self.workspace_root,
            workspace_root=self.workspace_root,
        )

        if self._runner_factory is not None:
            runner = self._runner_factory(doc, sink=sink, host=host)
        else:
            runner = GraphRunner(doc, sink=sink, host=host, persist_run_events=True)

        # Build context with pre-populated node_outputs
        ctx: dict[str, Any] = {
            "run_id": new_run_id,
            "last_result": True,
            "node_outputs": effective_pinned,
        }

        # Emit replay lifecycle events
        now = datetime.now(timezone.utc).isoformat()
        sink.emit(
            {
                "type": "replay_planned",
                "runId": new_run_id,
                "timestamp": now,
                "plan": plan.to_dict(),
            }
        )
        sink.emit(
            {
                "type": "replay_started",
                "runId": new_run_id,
                "timestamp": now,
                "parentRunId": plan.run_id,
                "startFromNode": plan.start_from_node,
            }
        )
        for node_id in plan.skipped_nodes:
            sink.emit(
                {
                    "type": "node_pinned_from_replay",
                    "runId": new_run_id,
                    "timestamp": now,
                    "nodeId": node_id,
                    "fromRunId": plan.run_id,
                }
            )

        # Write replay-of.json for traceability
        replay_meta: dict[str, Any] = {
            "replayOf": plan.run_id,
            "graphId": plan.graph_id,
            "startFromNode": plan.start_from_node,
            "skippedNodes": plan.skipped_nodes,
            "replayedNodes": plan.replayed_nodes,
            "createdAt": now,
        }
        (run_dir / "replay-of.json").write_text(
            json.dumps(replay_meta, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

        # Execute the graph from start_from_node using F40 run_from entry-point
        await asyncio.to_thread(runner.run_from, plan.start_from_node, context=ctx)

        # Write run-summary
        write_run_summary(
            run_dir,
            {
                "runId": new_run_id,
                "graphId": plan.graph_id,
                "status": "success",
                "startedAt": now,
                "replayOf": plan.run_id,
            },
        )

        return new_run_id
