"""`artifacts-size` and `artifacts-clear` commands.

MUST NOT:
- Import sibling command modules.
- Hold module-level mutable state.
"""
from __future__ import annotations

import argparse
from pathlib import Path


def register(sub: argparse._SubParsersAction) -> None:
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


def execute(args: argparse.Namespace) -> int:
    import sys

    if args.command == "artifacts-size":
        return _exec_size(args)
    if args.command == "artifacts-clear":
        return _exec_clear(args)
    print(f"artifacts: unknown command {args.command!r}", file=sys.stderr)
    return 2


def _exec_size(args: argparse.Namespace) -> int:
    import sys
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


def _exec_clear(args: argparse.Namespace) -> int:
    import sys
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
