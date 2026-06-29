"""`versions` and `rollback` commands — published-version management."""
from __future__ import annotations

import argparse
from pathlib import Path


def register(sub: argparse._SubParsersAction) -> None:
    vrs = sub.add_parser("versions", help="Manage published graph versions")
    vrs_sub = vrs.add_subparsers(dest="versions_command", required=True)

    vrs_list = vrs_sub.add_parser("list", help="List all published versions for a graph")
    vrs_list.add_argument("graph_id", help="Graph ID")
    vrs_list.add_argument("--workspace", type=Path, default=Path("."), help="Workspace root")

    vrs_show = vrs_sub.add_parser("show", help="Show metadata + document for a published version")
    vrs_show.add_argument("graph_id", help="Graph ID")
    vrs_show.add_argument("version", type=int, help="Version number")
    vrs_show.add_argument("--workspace", type=Path, default=Path("."), help="Workspace root")

    vrs_diff = vrs_sub.add_parser("diff", help="Diff two versions (use 'draft' or a version number)")
    vrs_diff.add_argument("graph_id", help="Graph ID")
    vrs_diff.add_argument("a", help="Version number A or 'draft'")
    vrs_diff.add_argument("b", help="Version number B or 'draft'")
    vrs_diff.add_argument("--workspace", type=Path, default=Path("."), help="Workspace root")

    rb = sub.add_parser("rollback", help="Overwrite draft with a published version snapshot")
    rb.add_argument("graph_id", help="Graph ID")
    rb.add_argument("version", type=int, help="Version number to restore")
    rb.add_argument("--workspace", type=Path, default=Path("."), help="Workspace root")


def execute(args: argparse.Namespace) -> int:
    import sys

    if args.command == "versions":
        return _exec_versions(args)
    if args.command == "rollback":
        return _exec_rollback(args)
    print(f"versions: unknown command {args.command!r}", file=sys.stderr)
    return 2


def _exec_versions(args: argparse.Namespace) -> int:
    import asyncio
    import json
    import sys

    from graph_caster.versioning import VersionManager
    from graph_caster.cli._helpers import parse_version_arg

    workspace = Path(args.workspace).resolve()
    mgr = VersionManager(workspace)

    if args.versions_command == "list":
        versions = asyncio.run(mgr.list_versions(args.graph_id))
        print(json.dumps([v.to_dict() for v in versions], ensure_ascii=False, indent=2))
        return 0

    if args.versions_command == "show":
        try:
            ver = asyncio.run(mgr.get_version(args.graph_id, args.version))
        except KeyError as e:
            print(str(e), file=sys.stderr)
            return 2
        try:
            doc = asyncio.run(mgr.load_graph(args.graph_id, args.version))
        except (FileNotFoundError, KeyError) as e:
            print(str(e), file=sys.stderr)
            return 2
        print(json.dumps({"version": ver.to_dict(), "document": doc}, ensure_ascii=False, indent=2))
        return 0

    if args.versions_command == "diff":
        try:
            v_a = parse_version_arg(str(args.a))
            v_b = parse_version_arg(str(args.b))
        except ValueError as e:
            print(str(e), file=sys.stderr)
            return 2
        try:
            result = asyncio.run(mgr.diff(args.graph_id, v_a, v_b))
        except (FileNotFoundError, KeyError) as e:
            print(str(e), file=sys.stderr)
            return 2
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    return 2


def _exec_rollback(args: argparse.Namespace) -> int:
    import asyncio
    import json
    import sys

    from graph_caster.versioning import VersionManager

    workspace = Path(args.workspace).resolve()
    mgr = VersionManager(workspace)
    try:
        asyncio.run(mgr.rollback_draft_to(args.graph_id, args.version))
    except (KeyError, FileNotFoundError) as e:
        print(str(e), file=sys.stderr)
        return 2
    print(json.dumps({"rolledBack": True, "graphId": args.graph_id, "version": args.version}, ensure_ascii=False))
    return 0
