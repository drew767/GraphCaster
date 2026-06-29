"""`publish` command — publish a draft as immutable version snapshot."""
from __future__ import annotations

import argparse
from pathlib import Path


def register(sub: argparse._SubParsersAction) -> None:
    pub = sub.add_parser("publish", help="Publish current draft as an immutable version snapshot")
    pub.add_argument("graph_id", help="Graph ID to publish")
    pub.add_argument("--message", default="", help="Release message (optional)")
    pub.add_argument("--author", default="", help="Author name (optional)")
    pub.add_argument(
        "--workspace",
        type=Path,
        default=Path("."),
        help="Workspace root (parent of graphs/ and versions/)",
    )


def execute(args: argparse.Namespace) -> int:
    import asyncio
    import json
    import sys

    from graph_caster.versioning import VersionManager

    workspace = Path(args.workspace).resolve()
    mgr = VersionManager(workspace)
    try:
        ver = asyncio.run(mgr.publish(args.graph_id, author=str(args.author or ""), message=str(args.message or "")))
    except FileNotFoundError as e:
        print(str(e), file=sys.stderr)
        return 2
    print(json.dumps(ver.to_dict(), ensure_ascii=False, indent=2))
    return 0
