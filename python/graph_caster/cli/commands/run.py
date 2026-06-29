"""`run` command: execute a graph document.

MUST NOT:
- Import sibling command modules.
- Hold module-level mutable state.
"""
from __future__ import annotations

import argparse
from pathlib import Path


def register(sub: argparse._SubParsersAction) -> None:
    run = sub.add_parser("run", help="Execute a graph document (stream NDJSON events to stdout)")
    run.add_argument("--document", "-d", type=Path, required=True, help="Path to graph JSON document")
    run.add_argument(
        "--start",
        "-s",
        default="",
        help="Override entry node id (default: validate and use the single 'start' node)",
    )
    run.add_argument(
        "--graphs-dir",
        "-g",
        type=Path,
        default=None,
        help="Directory of *.json graphs for graph_ref resolution (graphId → file)",
    )
    run.add_argument(
        "--workspace-root",
        type=Path,
        default=None,
        help="Workspace root for .graphcaster/workspace.secrets.env; if omitted, parent of --graphs-dir is used when -g is set",
    )
    run.add_argument(
        "--artifacts-base",
        type=Path,
        default=None,
        help="Workspace root under which runs/<graphId>/<timestamp>/ is created for this run",
    )
    run.add_argument(
        "--no-persist-run-events",
        action="store_true",
        help="Disable writing events.ndjson and run-summary.json under the run dir (default: persist when --artifacts-base is set)",
    )
    run.add_argument(
        "--track-session",
        action="store_true",
        help="Register this root run in the process-wide session registry (for cancel / inspection APIs)",
    )
    run.add_argument(
        "--control-stdin",
        action="store_true",
        help="Read NDJSON lines from stdin (same process) with {type:\"cancel_run\",runId:\"...\"} — requires --track-session (Dify-style command channel)",
    )
    run.add_argument(
        "--run-id",
        default=None,
        help="Fixed root run UUID string (so cancel_run can target this run); default is generated",
    )
    run.add_argument(
        "--until-node",
        default=None,
        metavar="NODE_ID",
        help="Stop after this node completes successfully (run still starts at the document start node; --start is ignored)",
    )
    run.add_argument(
        "--context-json",
        type=Path,
        default=None,
        help="Merge node_outputs from this JSON object (key node_outputs: { nodeId: … }) into run context before start",
    )
    run.add_argument(
        "--use-pins",
        action="store_true",
        default=False,
        help=(
            "F48: auto-populate ancestor node outputs from each ancestor's gcPin.payload "
            "before a mid-graph --start run (requires --start)"
        ),
    )
    run.add_argument(
        "--pins-from-run",
        default=None,
        metavar="RUN_ID",
        help=(
            "F48: load pinned outputs from a previous run's events.ndjson (identified by run ID); "
            "requires --artifacts-base so the runs/ tree can be scanned"
        ),
    )
    run.add_argument(
        "--pin-output",
        action="append",
        default=[],
        metavar="nodeId:jsonPath:value",
        dest="pin_outputs",
        help=(
            "F48: explicit per-node output override in the form nodeId:key:jsonValue "
            "(can repeat); takes priority over --use-pins and --pins-from-run"
        ),
    )
    run.add_argument(
        "--nested-context-out",
        type=Path,
        default=None,
        help=argparse.SUPPRESS,
    )
    run.add_argument(
        "--step-cache",
        action="store_true",
        help="Enable cross-run step cache for task nodes with data.stepCache (requires --artifacts-base)",
    )
    run.add_argument(
        "--step-cache-dirty",
        default="",
        metavar="NODE_IDS",
        help="Comma-separated node ids that skip cache read (re-exec like n8n dirtyNodeNames); requires --step-cache",
    )
    run.add_argument(
        "--step-cache-strategy",
        default="id",
        choices=["id", "input-signature", "lru"],
        metavar="STRATEGY",
        help=(
            "Cache key strategy when --step-cache is set: "
            "'id' (default, original behavior), "
            "'input-signature' (ComfyUI-style ancestor hash — survives graph restructuring), "
            "'lru' (id strategy with in-process LRU eviction, size controlled by --step-cache-lru-max)"
        ),
    )
    run.add_argument(
        "--step-cache-lru-max",
        type=int,
        default=1024,
        metavar="N",
        help="Max entries for LRU in-process cache when --step-cache-strategy=lru (default 1024)",
    )
    run.add_argument(
        "--fork-max-parallel",
        type=int,
        default=None,
        metavar="N",
        help="Upper bound on parallel fork branches (>=1); also fork.data.maxParallel and GC_FORK_MAX_PARALLEL; default 1 is sequential",
    )
    run.add_argument(
        "--public-stream",
        action="store_true",
        help=(
            "Omit node_execute data from stdout NDJSON (metadata only); run dir events.ndjson still "
            "receives full redacted payloads when --artifacts-base is set. Also set via GC_PUBLIC_RUN_STREAM."
        ),
    )
    run.add_argument(
        "--scheduler",
        default=None,
        choices=["fifo", "ux-friendly"],
        metavar="MODE",
        help=(
            "Node pick order: 'ux-friendly' (default) picks output/exit/async nodes first so the "
            "user sees results sooner; 'fifo' preserves strict insertion order. "
            "Also controlled by env GC_SCHEDULER_UX_FRIENDLY=on|off."
        ),
    )


def execute(args: argparse.Namespace) -> int:
    import json
    import os
    import sys
    from pathlib import Path as _Path

    from graph_caster.host_context import RunHostContext
    from graph_caster.models import GraphDocument
    from graph_caster.run_event_sink import NdjsonStdoutSink, NodeExecutePublicStreamSink
    from graph_caster.runner import GraphRunner
    from graph_caster.run_sessions import get_default_run_registry
    from graph_caster.nested_run_subprocess import write_nested_run_result_json
    from graph_caster.validate import GraphStructureError, validate_graph_structure
    from graph_caster.cli._helpers import merge_context_json, spawn_stdin_cancel_loop

    raw = json.loads(args.document.read_text(encoding="utf-8"))
    try:
        doc = GraphDocument.from_dict(raw)
    except ValueError as e:
        print(str(e), file=sys.stderr)
        return 2

    graphs_root = _Path(args.graphs_dir) if args.graphs_dir is not None else None
    if graphs_root is not None:
        from graph_caster.graph_ref_workspace import (
            build_workspace_graph_ref_adjacency,
            find_workspace_graph_ref_cycle,
        )
        from graph_caster.workspace import WorkspaceIndexError

        try:
            adj = build_workspace_graph_ref_adjacency(graphs_root)
        except WorkspaceIndexError as e:
            print(str(e), file=sys.stderr)
            return 2
        cyc = find_workspace_graph_ref_cycle(adj)
        if cyc:
            if len(cyc) == 1:
                chain = f"{cyc[0]} -> {cyc[0]}"
            else:
                chain = " -> ".join(cyc + [cyc[0]])
            print(f"graph-caster: graph_ref dependency cycle in workspace: {chain}", file=sys.stderr)
            return 3

    public_stream = bool(args.public_stream) or (
        (os.environ.get("GC_PUBLIC_RUN_STREAM") or "").strip().lower() in ("1", "true", "yes", "on")
    )
    sink_inner = NdjsonStdoutSink(sys.stdout.write, sys.stdout.flush)
    sink = (
        NodeExecutePublicStreamSink(sink_inner, omit_node_execute_payload=True)
        if public_stream
        else sink_inner
    )

    artifacts_base = _Path(args.artifacts_base) if args.artifacts_base is not None else None
    workspace_root = _Path(args.workspace_root).resolve() if args.workspace_root is not None else None
    host = RunHostContext(
        graphs_root=graphs_root,
        artifacts_base=artifacts_base,
        workspace_root=workspace_root,
    )
    reg = get_default_run_registry() if args.track_session else None
    if args.control_stdin:
        if reg is None:
            print("graph-caster run: --control-stdin requires --track-session", file=sys.stderr)
            return 2
        spawn_stdin_cancel_loop(reg)

    until = args.until_node.strip() if args.until_node and str(args.until_node).strip() else None
    if until is not None:
        ids = {n.id for n in doc.nodes}
        if until not in ids:
            print(f"graph-caster: --until-node {until!r} is not a node id in the document", file=sys.stderr)
            return 2

    if args.step_cache and args.artifacts_base is None:
        print("graph-caster run: --step-cache requires --artifacts-base", file=sys.stderr)
        return 2

    from graph_caster.node_output_cache import StepCachePolicy

    dirty_csv = str(args.step_cache_dirty or "").strip()
    dirty_nodes = frozenset(p.strip() for p in dirty_csv.split(",") if p.strip())
    if args.step_cache:
        from graph_caster.cache_strategies import strategy_from_name

        lru_max = max(1, int(args.step_cache_lru_max or 1024))
        _strategy = strategy_from_name(
            str(args.step_cache_strategy or "id"),
            lru_max=lru_max,
        )
        step_cache_pol = StepCachePolicy(
            enabled=True,
            dirty_nodes=dirty_nodes,
            cache_strategy=_strategy,
        )
    else:
        step_cache_pol = None

    stop_after = until
    persist_ev = artifacts_base is not None and not bool(args.no_persist_run_events)
    runner = GraphRunner(
        doc,
        sink=sink,
        host=host,
        session_registry=reg,
        stop_after_node_id=stop_after,
        step_cache=step_cache_pol,
        persist_run_events=persist_ev,
        fork_max_parallel=args.fork_max_parallel,
        public_stream=public_stream,
        scheduler=getattr(args, "scheduler", None),
    )
    # F48: parse --pin-output overrides (nodeId:key:jsonValue)
    pin_overrides: dict[str, dict] = {}
    for po in (args.pin_outputs or []):
        parts = po.split(":", 2)
        if len(parts) != 3:
            print(
                f"graph-caster: --pin-output {po!r}: expected format nodeId:key:jsonValue",
                file=sys.stderr,
            )
            return 2
        po_node, po_key, po_raw = parts
        po_node, po_key = po_node.strip(), po_key.strip()
        if not po_node or not po_key:
            print(
                f"graph-caster: --pin-output {po!r}: nodeId and key must not be empty",
                file=sys.stderr,
            )
            return 2
        try:
            po_val = json.loads(po_raw)
        except json.JSONDecodeError:
            po_val = po_raw
        pin_overrides.setdefault(po_node, {})[po_key] = po_val

    try:
        ctx: dict = {"last_result": True}
        if args.run_id is not None and str(args.run_id).strip():
            ctx["run_id"] = str(args.run_id).strip()
        if args.context_json is not None:
            try:
                merge_context_json(ctx, _Path(args.context_json))
            except (OSError, json.JSONDecodeError, ValueError) as e:
                print(f"graph-caster: context-json: {e}", file=sys.stderr)
                return 2

        # F48: build pinned context for --start with --use-pins / --pins-from-run / --pin-output
        use_pins_flag = bool(getattr(args, "use_pins", False))
        pins_from_run = (getattr(args, "pins_from_run", None) or "").strip() or None
        has_f48 = (use_pins_flag or pins_from_run or pin_overrides) and args.start and until is None
        if has_f48:
            import asyncio as _asyncio
            from graph_caster.partial_exec import build_pinned_context

            _ws = workspace_root or artifacts_base or _Path(".")
            _pctx = _asyncio.run(
                build_pinned_context(
                    graph=raw,
                    start_node=args.start,
                    use_pins=use_pins_flag,
                    from_run_id=pins_from_run,
                    workspace_root=_ws,
                    overrides=pin_overrides or None,
                )
            )
            bucket = ctx.setdefault("node_outputs", {})
            bucket.update(_pctx.get("node_outputs", {}))
        elif pin_overrides and not args.start:
            print(
                "graph-caster: --pin-output requires --start (mid-graph entry point)",
                file=sys.stderr,
            )
            return 2

        if until is not None and args.start:
            print(
                "graph-caster: note: --until-node runs from the document start; ignoring --start",
                file=sys.stderr,
            )

        try:
            if args.start and until is None:
                try:
                    canon = validate_graph_structure(doc)
                except GraphStructureError:
                    canon = ""
                if canon and args.start != canon and args.context_json is None:
                    print(
                        "graph-caster: warning: mid-graph --start without --context-json "
                        "may break edge conditions; prefer --context-json with node_outputs.",
                        file=sys.stderr,
                    )
                runner.run_from(args.start, context=ctx)
            elif until is not None:
                runner.run(context=ctx)
            else:
                runner.run(context=ctx)
        finally:
            if args.nested_context_out is not None:
                try:
                    write_nested_run_result_json(ctx, _Path(args.nested_context_out))
                except OSError:
                    pass
    except GraphStructureError as e:
        print(str(e), file=sys.stderr)
        return 2
    return 0
