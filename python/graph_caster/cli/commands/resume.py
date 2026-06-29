"""`resume` command — resume a paused run."""
from __future__ import annotations

import argparse
from pathlib import Path


def register(sub: argparse._SubParsersAction) -> None:
    res = sub.add_parser(
        "resume",
        help="Resume a paused run (human_input node) with a provided payload",
    )
    res.add_argument("run_id", help="Run ID of the paused run")
    res.add_argument("--node", required=True, dest="node_id", help="Node ID of the paused human_input node")
    res.add_argument(
        "--payload",
        default="null",
        help="JSON-encoded human response payload (default: null)",
    )
    res.add_argument(
        "--responded-by",
        default="",
        dest="responded_by",
        help="Identifier of the responder (optional)",
    )
    res.add_argument(
        "--workspace",
        type=Path,
        default=None,
        help="Workspace root / artifacts base (parent of runs/)",
    )
    res.add_argument(
        "--graphs-dir",
        "-g",
        type=Path,
        default=None,
        help="Directory of *.json graphs for graph document lookup",
    )


def execute(args: argparse.Namespace) -> int:
    import asyncio as _asyncio_r
    import datetime as _dt
    import json
    import subprocess as _sp
    import sys

    run_id = str(args.run_id).strip()
    node_id = str(args.node_id).strip()
    responded_by = str(args.responded_by or "").strip()

    try:
        payload = json.loads(args.payload)
    except json.JSONDecodeError as exc:
        print(f"graph-caster resume: --payload is not valid JSON: {exc}", file=sys.stderr)
        return 2

    workspace = Path(args.workspace).resolve() if args.workspace else Path(".").resolve()
    graphs_dir = Path(args.graphs_dir).resolve() if args.graphs_dir else None

    from graph_caster.pause_resume import CheckpointStore as _CpStore

    store = _CpStore(workspace)

    try:
        checkpoint = _asyncio_r.run(store.load(run_id))
    except Exception as exc:
        print(f"graph-caster resume: failed to load checkpoint: {exc}", file=sys.stderr)
        return 2

    if checkpoint is None:
        print(f"graph-caster resume: no paused checkpoint found for run {run_id!r}", file=sys.stderr)
        return 1

    if checkpoint.paused_at_node != node_id:
        print(
            f"graph-caster resume: run is paused at node {checkpoint.paused_at_node!r}, "
            f"but --node={node_id!r} was provided",
            file=sys.stderr,
        )
        return 2

    effective_graphs_dir = graphs_dir
    if effective_graphs_dir is None:
        candidate = workspace / "graphs"
        if candidate.is_dir():
            effective_graphs_dir = candidate

    graph_file: Path | None = None
    if effective_graphs_dir is not None and effective_graphs_dir.is_dir():
        for cand in effective_graphs_dir.glob("*.json"):
            try:
                doc_raw = json.loads(cand.read_text(encoding="utf-8"))
                gid = str(doc_raw.get("graphId") or "")
                if not gid:
                    gid = str((doc_raw.get("meta") or {}).get("graphId") or "")
                if gid == checkpoint.graph_id:
                    graph_file = cand
                    break
            except Exception:
                pass

    if graph_file is None:
        print(
            f"graph-caster resume: graph document for graphId {checkpoint.graph_id!r} not found",
            file=sys.stderr,
        )
        return 2

    responded_at = _dt.datetime.now(_dt.timezone.utc).isoformat()
    node_outputs = dict(checkpoint.node_outputs)
    node_outputs[node_id] = {
        "nodeType": "human_input",
        "humanInput": {
            "value": payload,
            "approved": payload if checkpoint.kind == "approval" else None,
            "respondedAt": responded_at,
            "respondedBy": responded_by,
            "timedOut": False,
        },
    }

    import tempfile as _tf

    with _tf.NamedTemporaryFile(
        mode="w", suffix=".json", delete=False, encoding="utf-8"
    ) as _ctxf:
        json.dump({"node_outputs": node_outputs}, _ctxf, ensure_ascii=False)
        ctx_json_path = _ctxf.name

    cmd = [
        sys.executable,
        "-m",
        "graph_caster",
        "run",
        "-d",
        str(graph_file),
        "--run-id",
        run_id,
        "--start",
        node_id,
        "--context-json",
        ctx_json_path,
        "--artifacts-base",
        str(workspace),
    ]
    if effective_graphs_dir is not None:
        cmd += ["-g", str(effective_graphs_dir)]

    try:
        _asyncio_r.run(store.delete(run_id))
    except Exception:
        pass

    try:
        proc = _sp.run(cmd, check=False)
        return proc.returncode
    except Exception as exc:
        print(f"graph-caster resume: spawn failed: {exc}", file=sys.stderr)
        return 2
