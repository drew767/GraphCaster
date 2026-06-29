"""`composio` command — Composio integrations bridge."""
from __future__ import annotations

import argparse
from pathlib import Path


def register(sub: argparse._SubParsersAction) -> None:
    cmp = sub.add_parser(
        "composio",
        help="Composio integrations bridge (requires pip install -e '.[composio]')",
    )
    cmp_sub = cmp.add_subparsers(dest="composio_command", required=True)

    cmp_apps = cmp_sub.add_parser("list-apps", help="List enabled Composio apps")
    cmp_apps.add_argument("--workspace", type=Path, default=None, help="Workspace root for secret resolution")

    cmp_actions = cmp_sub.add_parser("list-actions", help="List available Composio actions")
    cmp_actions.add_argument("--app", default=None, help="Filter by app name (e.g. GITHUB)")
    cmp_actions.add_argument("--workspace", type=Path, default=None, help="Workspace root for secret resolution")

    cmp_schema = cmp_sub.add_parser("schema", help="Print JSON schema for a Composio action")
    cmp_schema.add_argument("action", help="Action name, e.g. GITHUB_CREATE_ISSUE")
    cmp_schema.add_argument("--workspace", type=Path, default=None, help="Workspace root for secret resolution")

    cmp_invoke = cmp_sub.add_parser("invoke", help="Invoke a Composio action")
    cmp_invoke.add_argument("action", help="Action name, e.g. SLACK_SEND_MESSAGE")
    cmp_invoke.add_argument("--params", default="{}", help="JSON-encoded params dict")
    cmp_invoke.add_argument("--entity-id", default="default", dest="entity_id", help="Composio entity ID")
    cmp_invoke.add_argument("--workspace", type=Path, default=None, help="Workspace root for secret resolution")


def execute(args: argparse.Namespace) -> int:
    import asyncio
    import json
    import sys

    try:
        from graph_caster.tools.composio.bridge import ComposioBridge
    except ImportError as exc:
        print(f"graph-caster composio: {exc}", file=sys.stderr)
        return 2

    workspace = Path(args.workspace).resolve() if getattr(args, "workspace", None) is not None else None
    bridge = ComposioBridge(workspace_root=workspace)

    if args.composio_command == "list-apps":
        try:
            apps = asyncio.run(bridge.list_apps())
        except ImportError as exc:
            print(str(exc), file=sys.stderr)
            return 2
        except Exception as exc:
            print(f"graph-caster composio list-apps: {exc}", file=sys.stderr)
            return 2
        print(json.dumps(apps, ensure_ascii=False, indent=2))
        return 0

    if args.composio_command == "list-actions":
        app_filter: str | None = getattr(args, "app", None)
        try:
            actions = asyncio.run(bridge.list_actions(app=app_filter))
        except ImportError as exc:
            print(str(exc), file=sys.stderr)
            return 2
        except Exception as exc:
            print(f"graph-caster composio list-actions: {exc}", file=sys.stderr)
            return 2
        print(
            json.dumps(
                [
                    {
                        "name": a.name,
                        "app": a.app,
                        "display_name": a.display_name,
                        "description": a.description,
                    }
                    for a in actions
                ],
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0

    if args.composio_command == "schema":
        try:
            schema = asyncio.run(bridge.get_action_schema(args.action))
        except ImportError as exc:
            print(str(exc), file=sys.stderr)
            return 2
        except Exception as exc:
            print(f"graph-caster composio schema: {exc}", file=sys.stderr)
            return 2
        print(json.dumps(schema, ensure_ascii=False, indent=2))
        return 0

    if args.composio_command == "invoke":
        try:
            params = json.loads(args.params)
        except json.JSONDecodeError as exc:
            print(f"graph-caster composio invoke: invalid --params JSON: {exc}", file=sys.stderr)
            return 2
        entity_id = str(args.entity_id or "default")
        try:
            result = asyncio.run(bridge.invoke(args.action, params, entity_id=entity_id))
        except ImportError as exc:
            print(str(exc), file=sys.stderr)
            return 2
        except Exception as exc:
            print(f"graph-caster composio invoke: {exc}", file=sys.stderr)
            return 2
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    return 2
