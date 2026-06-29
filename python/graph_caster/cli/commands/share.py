"""`share` command — public sharing links for graphs."""
from __future__ import annotations

import argparse
from pathlib import Path


def register(sub: argparse._SubParsersAction) -> None:
    sh = sub.add_parser("share", help="Manage public sharing links for graphs (F86)")
    sh_sub = sh.add_subparsers(dest="share_command", required=True)

    sh_create = sh_sub.add_parser("create", help="Create a public sharing link for a graph")
    sh_create.add_argument("graph_id", help="Graph ID to share")
    sh_create.add_argument(
        "--permissions",
        default="view-and-run",
        choices=["view", "run", "view-and-run"],
        help="Permissions granted by this link (default: view-and-run)",
    )
    sh_create.add_argument(
        "--version",
        type=int,
        default=None,
        help="Pin to a specific published version (default: current draft)",
    )
    sh_create.add_argument(
        "--expires",
        dest="expires_at",
        default=None,
        metavar="ISO_DATE",
        help="Expiry date in ISO format, e.g. 2026-12-31 (optional)",
    )
    sh_create.add_argument(
        "--max-uses",
        type=int,
        default=None,
        dest="max_uses",
        help="Maximum number of times this link may be used (optional, default unlimited)",
    )
    sh_create.add_argument(
        "--workspace",
        type=Path,
        default=Path("."),
        help="Workspace root (default: current directory)",
    )

    sh_list = sh_sub.add_parser("list", help="List sharing links in the workspace")
    sh_list.add_argument(
        "--workspace",
        type=Path,
        default=Path("."),
        help="Workspace root (default: current directory)",
    )
    sh_list.add_argument(
        "--graph",
        dest="graph_id",
        default=None,
        help="Filter by graph ID (optional)",
    )

    sh_revoke = sh_sub.add_parser("revoke", help="Revoke a sharing link by its ID")
    sh_revoke.add_argument("link_id", help="Share link ID to revoke")
    sh_revoke.add_argument(
        "--workspace",
        type=Path,
        default=Path("."),
        help="Workspace root (default: current directory)",
    )


def execute(args: argparse.Namespace) -> int:
    import asyncio as _asyncio_share
    import json
    import sys

    from graph_caster.sharing import ShareLink, ShareLinkNotFoundError, ShareLinkStore

    workspace = Path(args.workspace).resolve()
    store = ShareLinkStore(workspace)

    if args.share_command == "create":
        graph_id = str(args.graph_id).strip()
        permissions = str(args.permissions or "view-and-run")
        graph_version: int | None = getattr(args, "version", None)
        expires_at: str | None = getattr(args, "expires_at", None)
        if expires_at:
            if "T" not in expires_at and len(expires_at) == 10:
                expires_at = expires_at + "T00:00:00+00:00"
        max_uses: int | None = getattr(args, "max_uses", None)

        lnk = ShareLink(
            id="",
            graph_id=graph_id,
            graph_version=graph_version,
            permissions=permissions,
            expires_at=expires_at,
            max_uses=max_uses,
            uses=0,
            created_by="",
            created_at="",
            metadata={},
        )
        created = _asyncio_share.run(store.create(lnk))
        from graph_caster.sharing import _link_url
        d = created.to_dict()
        d["url"] = _link_url(created.id)
        print(json.dumps(d, ensure_ascii=False, indent=2))
        return 0

    if args.share_command == "list":
        graph_id_filter: str | None = getattr(args, "graph_id", None)
        if graph_id_filter:
            links = _asyncio_share.run(store.list_for_graph(graph_id_filter))
        else:
            with store._lock:
                links = list(store._load_all().values())
        from graph_caster.sharing import _link_url
        out = [dict(lnk.to_dict(), url=_link_url(lnk.id)) for lnk in links]
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return 0

    if args.share_command == "revoke":
        link_id = str(args.link_id).strip()
        try:
            _asyncio_share.run(store.revoke(link_id))
        except ShareLinkNotFoundError:
            print(f"share revoke: link {link_id!r} not found", file=sys.stderr)
            return 2
        print(json.dumps({"revoked": link_id}, ensure_ascii=False))
        return 0

    return 2
