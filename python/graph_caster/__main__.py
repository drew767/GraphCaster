# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from graph_caster.host_context import RunHostContext
from graph_caster.models import GraphDocument
from graph_caster.runner import GraphRunner
from graph_caster.validate import GraphStructureError

_SUBCOMMANDS = frozenset({"run", "artifacts-size", "artifacts-clear"})


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
        "--artifacts-base",
        type=Path,
        default=None,
        help="Workspace root under which runs/<graphId>/<timestamp>/ is created for this run",
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

    return parser


def _cmd_run(args: argparse.Namespace) -> int:
    raw = json.loads(args.document.read_text(encoding="utf-8"))
    try:
        doc = GraphDocument.from_dict(raw)
    except ValueError as e:
        print(str(e), file=sys.stderr)
        return 2

    def sink(ev: dict) -> None:
        print(json.dumps(ev, ensure_ascii=False), flush=True)

    graphs_root = Path(args.graphs_dir) if args.graphs_dir is not None else None
    artifacts_base = Path(args.artifacts_base) if args.artifacts_base is not None else None
    host = RunHostContext(graphs_root=graphs_root, artifacts_base=artifacts_base)
    runner = GraphRunner(doc, sink=sink, host=host)
    try:
        ctx = {"last_result": True}
        if args.start:
            runner.run_from(args.start, context=ctx)
        else:
            runner.run(context=ctx)
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
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
