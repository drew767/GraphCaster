# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import argparse
import copy
import json
import os
import sys
import threading
from pathlib import Path

from graph_caster.host_context import RunHostContext
from graph_caster.models import GraphDocument
from graph_caster.run_event_sink import NdjsonStdoutSink
from graph_caster.runner import GraphRunner
from graph_caster.run_sessions import RunSessionRegistry, get_default_run_registry
from graph_caster.nested_run_subprocess import NESTED_CONTEXT_INPUT_KEYS, write_nested_run_result_json
from graph_caster.validate import GraphStructureError, validate_graph_structure

_SUBCOMMANDS = frozenset({"run", "artifacts-size", "artifacts-clear", "serve", "mcp"})


def _spawn_stdin_cancel_loop(registry: RunSessionRegistry) -> None:
    def loop() -> None:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as exc:
                if os.environ.get("GC_CONTROL_STDIN_DEBUG", "").strip():
                    print(f"graph-caster: control-stdin JSON skip: {exc}", file=sys.stderr, flush=True)
                continue
            if obj.get("type") != "cancel_run":
                continue
            rid = obj.get("runId") if "runId" in obj else obj.get("run_id")
            if rid is not None and str(rid).strip():
                registry.request_cancel(str(rid).strip())

    threading.Thread(target=loop, daemon=True).start()


def _normalize_argv(argv: list[str]) -> list[str]:
    if not argv:
        return argv
    if argv[0] in _SUBCOMMANDS or argv[0] in ("-h", "--help"):
        return argv
    if "-d" in argv or "--document" in argv:
        return ["run"] + argv
    return argv


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="graph-caster", description="GraphCaster Python runner")
    sub = parser.add_subparsers(dest="command", required=True)

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
        "--fork-max-parallel",
        type=int,
        default=None,
        metavar="N",
        help="Upper bound on parallel fork branches (>=1); also fork.data.maxParallel and GC_FORK_MAX_PARALLEL; default 1 is sequential",
    )

    sz = sub.add_parser("artifacts-size", help="Print total artifact size in bytes under runs/")
    sz.add_argument("--base", type=Path, required=True, help="Workspace root (parent of runs/)")
    sz.add_argument(
        "--graph-id",
        default=None,
        help="If set, size only runs/<graphId>/; else entire runs/ tree",
    )

    cl = sub.add_parser("artifacts-clear", help="Delete artifact directories under runs/")
    cl.add_argument("--base", type=Path, required=True, help="Workspace root (parent of runs/)")
    g = cl.add_mutually_exclusive_group(required=True)
    g.add_argument("--graph-id", default=None, help="Remove runs/<graphId>/ only")
    g.add_argument("--all", action="store_true", help="Remove entire runs/ directory")

    srv = sub.add_parser(
        "serve",
        help="HTTP+SSE dev broker for web UI (wraps graph_caster run in a subprocess)",
    )
    srv.add_argument("--host", default="127.0.0.1", help="Bind address")
    srv.add_argument("--port", type=int, default=9847, help="Listen port")

    mcp = sub.add_parser(
        "mcp",
        help="Model Context Protocol server (stdio): tools to list/run graphs (requires pip install -e '.[mcp]')",
    )
    mcp.add_argument(
        "--graphs-dir",
        "-g",
        type=Path,
        required=True,
        help="Directory of *.json graphs (same as run -g)",
    )
    mcp.add_argument(
        "--workspace-root",
        type=Path,
        default=None,
        help="Workspace root for .graphcaster/workspace.secrets.env",
    )
    mcp.add_argument(
        "--artifacts-base",
        type=Path,
        default=None,
        help="Optional workspace root for runs/<graphId>/… (persist run-summary when set)",
    )

    return parser


def _merge_context_json(ctx: dict, path: Path) -> None:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("context-json root must be a JSON object")
    outs = raw.get("node_outputs")
    if isinstance(outs, dict):
        bucket = ctx.setdefault("node_outputs", {})
        bucket.update(copy.deepcopy(outs))
    for k in NESTED_CONTEXT_INPUT_KEYS:
        if k == "node_outputs":
            continue
        if k in raw:
            ctx[k] = copy.deepcopy(raw[k])


def _cmd_run(args: argparse.Namespace) -> int:
    raw = json.loads(args.document.read_text(encoding="utf-8"))
    try:
        doc = GraphDocument.from_dict(raw)
    except ValueError as e:
        print(str(e), file=sys.stderr)
        return 2

    graphs_root = Path(args.graphs_dir) if args.graphs_dir is not None else None
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

    sink = NdjsonStdoutSink(sys.stdout.write, sys.stdout.flush)

    artifacts_base = Path(args.artifacts_base) if args.artifacts_base is not None else None
    workspace_root = Path(args.workspace_root).resolve() if args.workspace_root is not None else None
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
        _spawn_stdin_cancel_loop(reg)

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
    step_cache_pol = (
        StepCachePolicy(enabled=True, dirty_nodes=dirty_nodes) if args.step_cache else None
    )

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
    )
    try:
        ctx: dict = {"last_result": True}
        if args.run_id is not None and str(args.run_id).strip():
            ctx["run_id"] = str(args.run_id).strip()
        if args.context_json is not None:
            try:
                _merge_context_json(ctx, Path(args.context_json))
            except (OSError, json.JSONDecodeError, ValueError) as e:
                print(f"graph-caster: context-json: {e}", file=sys.stderr)
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
                    write_nested_run_result_json(ctx, Path(args.nested_context_out))
                except OSError:
                    pass
    except GraphStructureError as e:
        print(str(e), file=sys.stderr)
        return 2
    return 0


def _cmd_artifacts_size(args: argparse.Namespace) -> int:
    from graph_caster.artifacts import artifacts_runs_total_bytes, artifacts_tree_bytes_for_graph

    base = Path(args.base).resolve()
    try:
        if args.graph_id:
            print(artifacts_tree_bytes_for_graph(base, args.graph_id))
        else:
            print(artifacts_runs_total_bytes(base))
    except ValueError as e:
        print(str(e), file=sys.stderr)
        return 2
    return 0


def _cmd_artifacts_clear(args: argparse.Namespace) -> int:
    from graph_caster.artifacts import clear_all_artifact_runs, clear_artifacts_for_graph

    base = Path(args.base).resolve()
    try:
        if args.all:
            clear_all_artifact_runs(base)
        else:
            gid = args.graph_id
            if not gid:
                print("artifacts-clear: --graph-id required unless --all", file=sys.stderr)
                return 2
            clear_artifacts_for_graph(base, gid)
    except ValueError as e:
        print(str(e), file=sys.stderr)
        return 2
    return 0


def _cmd_mcp(args: argparse.Namespace) -> int:
    try:
        import mcp  # noqa: F401
    except ImportError:
        print(
            "graph-caster mcp: install optional extra: pip install -e '.[mcp]'",
            file=sys.stderr,
        )
        return 2
    from graph_caster.mcp_server.server import host_from_cli, run_stdio

    host = host_from_cli(
        Path(args.graphs_dir),
        Path(args.workspace_root) if args.workspace_root is not None else None,
        Path(args.artifacts_base) if args.artifacts_base is not None else None,
    )
    run_stdio(host)
    return 0


def _cmd_serve(args: argparse.Namespace) -> int:
    try:
        import uvicorn
    except ImportError:
        print(
            "graph-caster serve: install broker extras: pip install -e '.[broker]'",
            file=sys.stderr,
        )
        return 2
    from graph_caster.run_broker.app import create_app

    app = create_app()
    uvicorn.run(app, host=str(args.host), port=int(args.port), log_level="warning")
    return 0


def main(argv: list[str] | None = None) -> int:
    if argv is None:
        argv = list(sys.argv[1:])
    if not argv:
        _build_parser().print_help()
        return 0
    argv = _normalize_argv(argv)
    parser = _build_parser()
    args = parser.parse_args(argv)
    if args.command == "run":
        return _cmd_run(args)
    if args.command == "artifacts-size":
        return _cmd_artifacts_size(args)
    if args.command == "artifacts-clear":
        return _cmd_artifacts_clear(args)
    if args.command == "serve":
        return _cmd_serve(args)
    if args.command == "mcp":
        return _cmd_mcp(args)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
