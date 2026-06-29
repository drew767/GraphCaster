"""Subcommand registry.

MAY:
- Map subcommand name → command module path.
- Build the root ArgumentParser by dispatching to each module's register().
- Dispatch parsed args to the matching module's execute().

MUST NOT:
- Contain business logic for any specific command.
- Have side-effects at import time other than declaring the map.
"""
from __future__ import annotations

import argparse
from importlib import import_module


# Map subcommand name → module path. Some modules expose multiple subcommands
# (artifacts, mcp, ai, user, versions); in those cases register() registers all
# of its names on the shared subparsers action.
_COMMAND_MODULES: dict[str, str] = {
    "run": "graph_caster.cli.commands.run",
    "artifacts-size": "graph_caster.cli.commands.artifacts",
    "artifacts-clear": "graph_caster.cli.commands.artifacts",
    "catalog-rebuild": "graph_caster.cli.commands.catalog",
    "serve": "graph_caster.cli.commands.serve",
    "worker": "graph_caster.cli.commands.worker",
    "mcp": "graph_caster.cli.commands.mcp",
    "mcp-oauth": "graph_caster.cli.commands.mcp",
    "export-mcp": "graph_caster.cli.commands.mcp",
    "kb": "graph_caster.cli.commands.kb",
    "vars": "graph_caster.cli.commands.vars_cmd",  # 'vars' is a builtin; file uses suffix to avoid shadowing
    "composio": "graph_caster.cli.commands.composio",
    "export-dataset": "graph_caster.cli.commands.export_dataset",
    "rag": "graph_caster.cli.commands.rag",
    "publish": "graph_caster.cli.commands.publish",
    "versions": "graph_caster.cli.commands.versions",
    "rollback": "graph_caster.cli.commands.versions",
    "ai-build": "graph_caster.cli.commands.ai",
    "ai-refine": "graph_caster.cli.commands.ai",
    "openapi": "graph_caster.cli.commands.openapi",
    "tools": "graph_caster.cli.commands.tools",
    "audit": "graph_caster.cli.commands.audit",
    "tenant": "graph_caster.cli.commands.user",
    "user": "graph_caster.cli.commands.user",
    "member": "graph_caster.cli.commands.user",
    "auth": "graph_caster.cli.commands.user",
    "replay": "graph_caster.cli.commands.replay",
    "rbac": "graph_caster.cli.commands.rbac",
    "collab": "graph_caster.cli.commands.collab",
    "plugin": "graph_caster.cli.commands.plugin",
    "registry": "graph_caster.cli.commands.registry",
    "share": "graph_caster.cli.commands.share",
    "resume": "graph_caster.cli.commands.resume",
}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="graph-caster", description="GraphCaster Python runner")
    sub = parser.add_subparsers(dest="command", required=True)
    for module_path in sorted(set(_COMMAND_MODULES.values())):
        mod = import_module(module_path)
        mod.register(sub)
    return parser


def dispatch(args: argparse.Namespace) -> int:
    module_path = _COMMAND_MODULES.get(args.command)
    if module_path is None:
        raise SystemExit(f"Unknown command: {args.command}")
    mod = import_module(module_path)
    return mod.execute(args)
