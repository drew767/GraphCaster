"""`tools` command — built-in tool registry."""
from __future__ import annotations

import argparse


def register(sub: argparse._SubParsersAction) -> None:
    tl = sub.add_parser("tools", help="Built-in tool registry (F64)")
    tl_sub = tl.add_subparsers(dest="tools_command", required=True)

    tl_sub.add_parser("list", help="List all built-in tools")

    tl_show = tl_sub.add_parser("show", help="Show details for a built-in tool")
    tl_show.add_argument("tool_name", help="Tool name, e.g. calc")

    tl_invoke = tl_sub.add_parser("invoke", help="Invoke a built-in tool")
    tl_invoke.add_argument("tool_name", help="Tool name, e.g. calc")
    tl_invoke.add_argument(
        "--args",
        default="{}",
        help="JSON-encoded arguments dict (default: {})",
    )


def execute(args: argparse.Namespace) -> int:
    import asyncio as _asyncio
    import json
    import sys

    from graph_caster.tools.registry import get_default_registry

    registry = get_default_registry()

    if args.tools_command == "list":
        tools = registry.list()
        rows = [
            {"name": s.name, "display_name": s.display_name, "description": s.description}
            for s in tools
        ]
        print(json.dumps(rows, ensure_ascii=False, indent=2))
        return 0

    if args.tools_command == "show":
        spec = registry.get(args.tool_name)
        if spec is None:
            available = [s.name for s in registry.list()]
            print(
                f"tools show: unknown tool {args.tool_name!r}. Available: {available}",
                file=sys.stderr,
            )
            return 1
        out = {
            "name": spec.name,
            "display_name": spec.display_name,
            "description": spec.description,
            "parameters": spec.parameters,
        }
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return 0

    if args.tools_command == "invoke":
        spec = registry.get(args.tool_name)
        if spec is None:
            available = [s.name for s in registry.list()]
            print(
                f"tools invoke: unknown tool {args.tool_name!r}. Available: {available}",
                file=sys.stderr,
            )
            return 1
        try:
            tool_args = json.loads(args.args)
        except json.JSONDecodeError as exc:
            print(f"tools invoke: invalid --args JSON: {exc}", file=sys.stderr)
            return 2
        if not isinstance(tool_args, dict):
            print("tools invoke: --args must be a JSON object", file=sys.stderr)
            return 2
        try:
            result = _asyncio.run(spec.callable(**tool_args))
        except Exception as exc:
            print(f"tools invoke: {exc}", file=sys.stderr)
            return 2
        try:
            print(json.dumps(result, ensure_ascii=False, indent=2, default=lambda o: repr(o)))
        except Exception:
            print(repr(result))
        return 0

    return 2
