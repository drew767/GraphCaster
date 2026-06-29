"""`registry` command — plugin registry client."""
from __future__ import annotations

import argparse


def register(sub: argparse._SubParsersAction) -> None:
    reg_cmd = sub.add_parser("registry", help="Plugin registry client (PyPI + GitHub manifests, F97)")
    reg_sub = reg_cmd.add_subparsers(dest="registry_command", required=True)

    reg_search = reg_sub.add_parser("search", help="Search available plugins")
    reg_search.add_argument("query", nargs="?", default="", help="Search query (optional)")
    reg_search.add_argument("--limit", type=int, default=50, help="Max results (default 50)")

    reg_info = reg_sub.add_parser("info", help="Show details for a plugin")
    reg_info.add_argument("name", help="Plugin package name")

    reg_install = reg_sub.add_parser("install", help="Install a plugin from registry")
    reg_install.add_argument("name", help="Plugin package name")
    reg_install.add_argument("--version", default=None, help="Pin to a specific version")
    reg_install.add_argument("--allow-untrusted", action="store_true", dest="allow_untrusted",
                             help="Skip trust check")

    reg_uninstall = reg_sub.add_parser("uninstall", help="Uninstall a plugin")
    reg_uninstall.add_argument("name", help="Plugin package name")

    reg_sub.add_parser("list", help="List installed plugins (entry_points graphcaster.plugins)")

    reg_trust = reg_sub.add_parser("trust", help="Add plugin to registry trust list")
    reg_trust.add_argument("name", help="Plugin package name")

    reg_untrust = reg_sub.add_parser("untrust", help="Remove plugin from registry trust list")
    reg_untrust.add_argument("name", help="Plugin package name")


def execute(args: argparse.Namespace) -> int:
    import asyncio as _asyncio_reg
    import json
    import sys

    from graph_caster.plugin.registry_client import (
        PluginRegistryClient,
        add_trust,
        remove_trust,
    )

    client = PluginRegistryClient()

    if args.registry_command == "search":
        query = str(getattr(args, "query", "") or "")
        limit = int(getattr(args, "limit", 50) or 50)
        results = _asyncio_reg.run(client.search(query, limit=limit))
        print(json.dumps([e.to_dict() for e in results], ensure_ascii=False, indent=2))
        return 0

    if args.registry_command == "info":
        entry = _asyncio_reg.run(client.get(args.name))
        if entry is None:
            print(f"registry info: plugin {args.name!r} not found", file=sys.stderr)
            return 1
        print(json.dumps(entry.to_dict(), ensure_ascii=False, indent=2))
        return 0

    if args.registry_command == "install":
        version = getattr(args, "version", None)
        allow_untrusted = bool(getattr(args, "allow_untrusted", False))
        try:
            _asyncio_reg.run(client.install(args.name, version=version, allow_untrusted=allow_untrusted))
        except PermissionError as exc:
            print(f"registry install: {exc}", file=sys.stderr)
            return 2
        except RuntimeError as exc:
            print(f"registry install: {exc}", file=sys.stderr)
            return 2
        print(json.dumps({"installed": args.name, "version": version}, ensure_ascii=False))
        return 0

    if args.registry_command == "uninstall":
        try:
            _asyncio_reg.run(client.uninstall(args.name))
        except RuntimeError as exc:
            print(f"registry uninstall: {exc}", file=sys.stderr)
            return 2
        print(json.dumps({"uninstalled": args.name}, ensure_ascii=False))
        return 0

    if args.registry_command == "list":
        entries = _asyncio_reg.run(client.list_installed())
        print(json.dumps([e.to_dict() for e in entries], ensure_ascii=False, indent=2))
        return 0

    if args.registry_command == "trust":
        add_trust(args.name)
        print(json.dumps({"trusted": args.name}, ensure_ascii=False))
        return 0

    if args.registry_command == "untrust":
        remove_trust(args.name)
        print(json.dumps({"untrusted": args.name}, ensure_ascii=False))
        return 0

    return 2
