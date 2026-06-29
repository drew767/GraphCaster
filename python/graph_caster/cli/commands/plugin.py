"""`plugin` command — local plugin management."""
from __future__ import annotations

import argparse
from pathlib import Path


def register(sub: argparse._SubParsersAction) -> None:
    pl = sub.add_parser("plugin", help="Manage GraphCaster plugins (F92)")
    pl_sub = pl.add_subparsers(dest="plugin_command", required=True)

    pl_list = pl_sub.add_parser("list", help="List installed (entry-points) and local plugins")
    pl_list.add_argument("--search-dir", dest="search_dirs", action="append", type=Path, default=None, metavar="DIR")

    pl_load = pl_sub.add_parser("load", help="Load a plugin and register its contributions")
    pl_load.add_argument("name", help="Plugin name")
    pl_load.add_argument("--search-dir", dest="search_dirs", action="append", type=Path, default=None, metavar="DIR")
    pl_load.add_argument("--auto-trust", action="store_true", dest="auto_trust")

    pl_unload = pl_sub.add_parser("unload", help="Unload a plugin")
    pl_unload.add_argument("name")

    pl_info = pl_sub.add_parser("info", help="Print manifest JSON (without loading)")
    pl_info.add_argument("name")
    pl_info.add_argument("--search-dir", dest="search_dirs", action="append", type=Path, default=None, metavar="DIR")

    pl_trust = pl_sub.add_parser("trust", help="Grant permissions in trust file")
    pl_trust.add_argument("name")
    pl_trust.add_argument("--allow", required=True, metavar="PERMS")
    pl_trust.add_argument("--version", default="")
    pl_trust.add_argument("--search-dir", dest="search_dirs", action="append", type=Path, default=None, metavar="DIR")

    pl_untrust = pl_sub.add_parser("untrust", help="Remove from trust file")
    pl_untrust.add_argument("name")

    pl_watch = pl_sub.add_parser(
        "watch",
        help="Hot-reload: watch plugin source dirs for changes (requires GC_DEV=1)",
    )
    pl_watch.add_argument(
        "--search-dir",
        dest="search_dirs",
        action="append",
        type=Path,
        default=None,
        metavar="DIR",
        help="Plugin search directory (repeatable); defaults to standard search dirs",
    )
    pl_watch.add_argument(
        "--poll-interval",
        dest="poll_interval",
        type=float,
        default=1.0,
        metavar="SEC",
        help="Poll interval in seconds (default: 1.0)",
    )

    pl_new = pl_sub.add_parser("new", help="Scaffold a new plugin skeleton (F96)")
    pl_new.add_argument("name", help="Plugin name (e.g. my-plugin)")
    pl_new.add_argument("--author", default="", help="Author name")
    pl_new.add_argument("--description", default="", help="Short description")
    pl_new.add_argument(
        "--allow",
        default="",
        metavar="PERMS",
        help="Comma-separated permissions to pre-declare (storage,network,subprocess,secrets,model_calls)",
    )
    pl_new.add_argument(
        "--template",
        default="node",
        choices=["minimal", "node", "tool", "provider"],
        help="Scaffold template (default: node)",
    )
    pl_new.add_argument(
        "--dir",
        dest="target_dir",
        type=Path,
        default=Path("."),
        metavar="DIR",
        help="Parent directory to create the plugin in (default: current directory)",
    )

    pl_publish = pl_sub.add_parser("publish", help="Publish a plugin to a registry (F96)")
    pl_publish.add_argument("name", help="Plugin name to publish")


def execute(args: argparse.Namespace) -> int:
    import asyncio
    import json
    import sys

    from graph_caster.plugin.loader import PluginLoader
    from graph_caster.plugin.permissions import revoke_trust, write_trust

    search_dirs = [Path(d) for d in (getattr(args, "search_dirs", None) or [])]

    if args.plugin_command == "list":
        loader = PluginLoader(search_dirs=search_dirs if search_dirs else None)
        ep_names = loader.discover_entry_points()
        local_paths = loader.discover_local()
        print(json.dumps({"entry_points": ep_names, "local": [str(p) for p in local_paths]}, ensure_ascii=False, indent=2))
        return 0

    if args.plugin_command == "load":
        loader = PluginLoader(
            search_dirs=search_dirs if search_dirs else None,
            auto_trust=bool(getattr(args, "auto_trust", False)),
        )
        try:
            manifest = asyncio.run(loader.load(args.name))
        except (PermissionError, ModuleNotFoundError, ImportError, TypeError) as exc:
            print(f"graph-caster plugin load: {exc}", file=sys.stderr)
            return 2
        print(json.dumps(manifest.to_dict(), ensure_ascii=False, indent=2))
        return 0

    if args.plugin_command == "unload":
        print("graph-caster plugin unload: only meaningful in-process; use PluginLoader API.", file=sys.stderr)
        return 1

    if args.plugin_command == "info":
        loader = PluginLoader(search_dirs=search_dirs if search_dirs else None, auto_trust=True)
        try:
            manifest = asyncio.run(loader._import_manifest(args.name))
        except (ModuleNotFoundError, ImportError, TypeError) as exc:
            print(f"graph-caster plugin info: {exc}", file=sys.stderr)
            return 2
        print(manifest.to_json())
        return 0

    if args.plugin_command == "trust":
        raw_perms = [p.strip() for p in str(args.allow).split(",") if p.strip()]
        version = str(getattr(args, "version", "") or "").strip()
        if not version:
            loader = PluginLoader(search_dirs=search_dirs if search_dirs else None, auto_trust=True)
            try:
                manifest = asyncio.run(loader._import_manifest(args.name))
                version = manifest.version
            except Exception:
                version = "unknown"
        write_trust(args.name, version, frozenset(raw_perms))
        print(json.dumps({"trusted": args.name, "version": version, "permissions": raw_perms}, ensure_ascii=False))
        return 0

    if args.plugin_command == "untrust":
        revoke_trust(args.name)
        print(json.dumps({"untrusted": args.name}, ensure_ascii=False))
        return 0

    if args.plugin_command == "watch":
        import os as _os
        if not _os.environ.get("GC_DEV", "").strip():
            print(
                "graph-caster plugin watch: GC_DEV is not set. "
                "Set GC_DEV=1 to enable hot-reload.",
                file=sys.stderr,
            )
            return 1
        from graph_caster.plugin.hot_reload import HotReloadWatcher

        poll_interval = float(getattr(args, "poll_interval", 1.0))
        loader = PluginLoader(search_dirs=search_dirs if search_dirs else None)
        watcher = HotReloadWatcher(
            loader,
            search_dirs=search_dirs if search_dirs else None,
            poll_interval_sec=poll_interval,
        )

        async def _watch_forever() -> None:
            await watcher.start()
            print(
                json.dumps({"status": "watching", "poll_interval_sec": poll_interval}),
                flush=True,
            )
            try:
                while True:
                    await asyncio.sleep(3600)
            except (KeyboardInterrupt, asyncio.CancelledError):
                pass
            finally:
                await watcher.stop()

        try:
            asyncio.run(_watch_forever())
        except KeyboardInterrupt:
            pass
        return 0

    if args.plugin_command == "new":
        from graph_caster.plugin.scaffold import scaffold_plugin
        raw_perms = [p.strip() for p in str(getattr(args, "allow", "") or "").split(",") if p.strip()]
        target_dir = Path(getattr(args, "target_dir", None) or ".")
        template = getattr(args, "template", "node") or "node"
        try:
            created = scaffold_plugin(
                args.name,
                author=str(getattr(args, "author", "") or ""),
                description=str(getattr(args, "description", "") or ""),
                permissions=raw_perms,
                target_dir=target_dir,
                template=template,
            )
        except Exception as exc:
            print(f"graph-caster plugin new: {exc}", file=sys.stderr)
            return 2
        print(json.dumps({"created": str(created)}, ensure_ascii=False))
        return 0

    if args.plugin_command == "publish":
        print(
            "Plugin publish is not yet wired to a registry — "
            "build wheel with `python -m build` and publish manually.",
            file=sys.stderr,
        )
        return 1

    return 2
