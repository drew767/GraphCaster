"""`rbac` command — role-based access control."""
from __future__ import annotations

import argparse


def register(sub: argparse._SubParsersAction) -> None:
    rb = sub.add_parser("rbac", help="RBAC utilities: roles, scopes, permission checks")
    rb_sub = rb.add_subparsers(dest="rbac_command", required=True)

    rb_sub.add_parser("roles", help="List all roles and their assigned scopes")
    rb_sub.add_parser("scopes", help="List all known scopes across all roles")

    rb_check = rb_sub.add_parser("check", help="Check whether a user (by role) has a given scope")
    rb_check.add_argument("--user", required=True, help="User identifier (used for display only)")
    rb_check.add_argument("--role", required=True,
                          choices=["owner", "admin", "editor", "viewer", "dataset_operator"],
                          help="Role to evaluate")
    rb_check.add_argument("--scope", required=True, help="Scope to check, e.g. graph:edit")


def execute(args: argparse.Namespace) -> int:
    import json
    import sys

    from graph_caster.auth.rbac import ROLE_SCOPES, Role, has_scope, scopes_for_role

    if args.rbac_command == "roles":
        for role in Role:
            scopes = sorted(ROLE_SCOPES[role])
            print(f"{role.value}:")
            for s in scopes:
                print(f"  {s}")
        return 0

    if args.rbac_command == "scopes":
        all_scopes: set[str] = set()
        for scopes in ROLE_SCOPES.values():
            all_scopes.update(scopes)
        for s in sorted(all_scopes):
            print(s)
        return 0

    if args.rbac_command == "check":
        try:
            role = Role(args.role)
        except ValueError:
            print(f"rbac check: unknown role {args.role!r}", file=sys.stderr)
            return 2
        effective = scopes_for_role(role)
        granted = has_scope(effective, args.scope)
        status = "GRANTED" if granted else "DENIED"
        print(
            json.dumps(
                {
                    "user": args.user,
                    "role": role.value,
                    "scope": args.scope,
                    "result": status,
                    "effective_scopes": sorted(effective),
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0 if granted else 1

    return 2
