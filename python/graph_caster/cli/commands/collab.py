"""`collab` command — Collab CRDT utilities."""
from __future__ import annotations

import argparse
from pathlib import Path


def register(sub: argparse._SubParsersAction) -> None:
    cl = sub.add_parser("collab", help="Collab CRDT utilities (F77)")
    cl_sub = cl.add_subparsers(dest="collab_command", required=True)
    cl_dump = cl_sub.add_parser("dump", help="Print size of .collab.bin state for a graph")
    cl_dump.add_argument("graph_id", help="Graph ID to inspect")
    cl_dump.add_argument("--graphs-dir", type=Path, default=None, help="Directory of graph files")


def execute(args: argparse.Namespace) -> int:
    import json
    import sys

    from graph_caster.run_broker.collab_ws import _bin_path

    if args.collab_command == "dump":
        graphs_dir = getattr(args, "graphs_dir", None)
        if graphs_dir is not None:
            import os as _os
            _os.environ["GC_GRAPHS_DIR"] = str(graphs_dir)
        path = _bin_path(args.graph_id)
        if path is None:
            print(
                json.dumps({"error": "GC_GRAPHS_DIR not set; cannot locate .collab.bin"}),
                file=sys.stderr,
            )
            return 1
        if not path.exists():
            print(json.dumps({"graphId": args.graph_id, "exists": False, "bytes": 0}))
            return 0
        size = path.stat().st_size
        print(
            json.dumps(
                {
                    "graphId": args.graph_id,
                    "exists": True,
                    "bytes": size,
                    "path": str(path),
                    "note": "Binary Y.Doc state; full decode is a follow-up (no Python yjs dep).",
                }
            )
        )
        return 0

    print(f"graph-caster collab: unknown subcommand {args.collab_command!r}", file=sys.stderr)
    return 2
