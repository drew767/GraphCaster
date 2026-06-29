"""`vars` command — scoped variable management.

File is named `vars_cmd.py` (not `vars.py`) to avoid shadowing the Python builtin.
"""
from __future__ import annotations

import argparse
from pathlib import Path


def register(sub: argparse._SubParsersAction) -> None:
    vr = sub.add_parser("vars", help="Manage scoped variables (run/session/tenant/env)")
    vr_sub = vr.add_subparsers(dest="vars_command", required=True)

    vr_set = vr_sub.add_parser("set", help="Set a variable in scope.name form")
    vr_set.add_argument("key", help="Variable reference, e.g. tenant.api_endpoint")
    vr_set.add_argument("value", help="Value (JSON-decoded if valid, else stored as string)")
    vr_set.add_argument("--workspace", type=Path, default=Path("."), help="Workspace root")
    vr_set.add_argument("--tenant", default="default", help="Tenant id (default: default)")

    vr_get = vr_sub.add_parser("get", help="Get a variable value")
    vr_get.add_argument("key", help="Variable reference in scope.name form")
    vr_get.add_argument("--workspace", type=Path, default=Path("."))
    vr_get.add_argument("--tenant", default="default")

    vr_list = vr_sub.add_parser("list", help="List all variables in a scope")
    vr_list.add_argument(
        "--scope",
        required=True,
        choices=["sys", "run", "session", "conv", "tenant", "env"],
        help="Scope to list",
    )
    vr_list.add_argument("--workspace", type=Path, default=Path("."))
    vr_list.add_argument("--tenant", default="default")

    vr_del = vr_sub.add_parser("delete", help="Delete a variable")
    vr_del.add_argument("key", help="Variable reference in scope.name form")
    vr_del.add_argument("--workspace", type=Path, default=Path("."))
    vr_del.add_argument("--tenant", default="default")


def execute(args: argparse.Namespace) -> int:
    import asyncio
    import json
    import sys

    from graph_caster.variables import FileVariableStore, VariableContext, VariableScope
    from graph_caster.cli._helpers import parse_scope_key

    workspace = Path(args.workspace).resolve()
    store_root = workspace / ".graphcaster" / "vars"
    tenant_id = str(args.tenant or "default")
    store = FileVariableStore(store_root, tenant_id=tenant_id)

    ctx = VariableContext(
        store,
        run_id="cli",
        session_id=None,
        tenant_id=tenant_id,
    )

    if args.vars_command == "set":
        try:
            scope_str, var_name = parse_scope_key(args.key)
        except ValueError as e:
            print(str(e), file=sys.stderr)
            return 2
        try:
            scope = VariableScope(scope_str)
        except ValueError:
            print(f"vars set: unknown scope {scope_str!r}", file=sys.stderr)
            return 2
        raw_val: str = args.value
        try:
            value: object = json.loads(raw_val)
        except json.JSONDecodeError:
            value = raw_val
        try:
            asyncio.run(ctx.set(scope, var_name, value))
        except ValueError as e:
            print(str(e), file=sys.stderr)
            return 2
        print(json.dumps({"scope": scope_str, "key": var_name, "value": value}, ensure_ascii=False))
        return 0

    if args.vars_command == "get":
        try:
            scope_str, var_name = parse_scope_key(args.key)
        except ValueError as e:
            print(str(e), file=sys.stderr)
            return 2
        try:
            scope = VariableScope(scope_str)
        except ValueError:
            print(f"vars get: unknown scope {scope_str!r}", file=sys.stderr)
            return 2
        value = asyncio.run(ctx.get(scope, var_name))
        if value is None:
            print(f"vars get: {args.key} not found", file=sys.stderr)
            return 1
        print(json.dumps(value, ensure_ascii=False))
        return 0

    if args.vars_command == "list":
        try:
            scope = VariableScope(args.scope)
        except ValueError:
            print(f"vars list: unknown scope {args.scope!r}", file=sys.stderr)
            return 2
        data = asyncio.run(ctx.list_scope(scope))
        print(json.dumps(data, ensure_ascii=False, indent=2))
        return 0

    if args.vars_command == "delete":
        try:
            scope_str, var_name = parse_scope_key(args.key)
        except ValueError as e:
            print(str(e), file=sys.stderr)
            return 2
        try:
            scope = VariableScope(scope_str)
        except ValueError:
            print(f"vars delete: unknown scope {scope_str!r}", file=sys.stderr)
            return 2
        try:
            asyncio.run(ctx.delete(scope, var_name))
        except ValueError as e:
            print(str(e), file=sys.stderr)
            return 2
        print(json.dumps({"deleted": args.key}, ensure_ascii=False))
        return 0

    return 2
