"""`mcp`, `mcp-oauth`, `export-mcp` commands."""
from __future__ import annotations

import argparse
from pathlib import Path


def register(sub: argparse._SubParsersAction) -> None:
    mcp = sub.add_parser(
        "mcp",
        help="Model Context Protocol server (stdio): tools to list/run graphs (requires pip install -e '.[mcp]')",
    )
    mcp.add_argument(
        "--graphs-dir",
        "-g",
        type=Path,
        required=True,
        help="Directory of *.json graphs (same as run -g)",
    )
    mcp.add_argument(
        "--workspace-root",
        type=Path,
        default=None,
        help="Workspace root for .graphcaster/workspace.secrets.env",
    )
    mcp.add_argument(
        "--artifacts-base",
        type=Path,
        default=None,
        help="Optional workspace root for runs/<graphId>/… (persist run-summary when set)",
    )
    mcp.add_argument(
        "--per-graph-tools",
        action="store_true",
        default=False,
        help="Also expose one gc_<graphId> tool per discovered graph (F65)",
    )
    mcp.add_argument(
        "--watch",
        action="store_true",
        default=False,
        help="Hot-reload: poll graphs directory every 10 s and register new per-graph tools (requires --per-graph-tools)",
    )

    em = sub.add_parser(
        "export-mcp",
        help="Start a minimal MCP server exposing only one graph as a tool (requires pip install -e '.[mcp]')",
    )
    em.add_argument(
        "graph_id",
        help="Graph ID to export",
    )
    em.add_argument(
        "--graphs-dir",
        "-g",
        type=Path,
        required=True,
        help="Directory of *.json graphs",
    )
    em.add_argument(
        "--workspace-root",
        type=Path,
        default=None,
        help="Workspace root for .graphcaster/workspace.secrets.env",
    )
    em.add_argument(
        "--artifacts-base",
        type=Path,
        default=None,
        help="Optional workspace root for runs/<graphId>/… (persist run-summary when set)",
    )
    em.add_argument(
        "--bind",
        default="stdio",
        choices=["stdio", "http"],
        help="Transport: stdio (default) or http",
    )
    em.add_argument(
        "--port",
        type=int,
        default=8765,
        help="HTTP port when --bind=http (default 8765)",
    )

    mo = sub.add_parser(
        "mcp-oauth",
        help="OAuth token helpers for streamable HTTP MCP (e.g. GitHub device flow)",
    )
    mo_sub = mo.add_subparsers(dest="oauth_cmd", required=True)
    mo_gh = mo_sub.add_parser(
        "github-device",
        help="Run GitHub OAuth device flow; prints access token (for bearerEnvKey / workspace secrets)",
    )
    mo_gh.add_argument(
        "--scope",
        default="",
        help="OAuth scopes (space-separated), e.g. read:user repo",
    )
    mo_gh.add_argument(
        "--client-id",
        default=None,
        help="OAuth App client id (default: env GITHUB_OAUTH_CLIENT_ID)",
    )


def execute(args: argparse.Namespace) -> int:
    import sys

    if args.command == "mcp":
        return _exec_mcp(args)
    if args.command == "mcp-oauth":
        return _exec_mcp_oauth(args)
    if args.command == "export-mcp":
        return _exec_export_mcp(args)
    print(f"mcp: unknown command {args.command!r}", file=sys.stderr)
    return 2


def _exec_mcp(args: argparse.Namespace) -> int:
    import sys

    try:
        import mcp  # noqa: F401
    except ImportError:
        print(
            "graph-caster mcp: install optional extra: pip install -e '.[mcp]'",
            file=sys.stderr,
        )
        return 2
    from graph_caster.mcp_server.server import host_from_cli, run_stdio

    host = host_from_cli(
        Path(args.graphs_dir),
        Path(args.workspace_root) if args.workspace_root is not None else None,
        Path(args.artifacts_base) if args.artifacts_base is not None else None,
    )
    per_graph = bool(getattr(args, "per_graph_tools", False))
    watch = bool(getattr(args, "watch", False))
    run_stdio(host, per_graph_tools=per_graph, watch=watch)
    return 0


def _exec_mcp_oauth(args: argparse.Namespace) -> int:
    import os
    import sys

    if args.oauth_cmd != "github-device":
        print("graph-caster mcp-oauth: unknown subcommand", file=sys.stderr)
        return 2
    cid = (args.client_id or os.environ.get("GITHUB_OAUTH_CLIENT_ID", "")).strip()
    if not cid:
        print(
            "graph-caster mcp-oauth github-device: set --client-id or GITHUB_OAUTH_CLIENT_ID",
            file=sys.stderr,
        )
        return 2
    from graph_caster.mcp_oauth import GithubDeviceFlowError, run_github_device_flow

    try:
        token = run_github_device_flow(client_id=cid, scope=str(args.scope or ""))
    except GithubDeviceFlowError as e:
        print(f"graph-caster: {e}", file=sys.stderr)
        return 2
    print(token, flush=True)
    return 0


def _exec_export_mcp(args: argparse.Namespace) -> int:
    import sys

    try:
        import mcp  # noqa: F401
    except ImportError:
        print(
            "graph-caster export-mcp: install optional extra: pip install -e '.[mcp]'",
            file=sys.stderr,
        )
        return 2
    from graph_caster.mcp_server.server import host_from_cli
    from graph_caster.mcp_server.per_graph_tools import build_single_graph_fastmcp

    host = host_from_cli(
        Path(args.graphs_dir),
        Path(args.workspace_root) if args.workspace_root is not None else None,
        Path(args.artifacts_base) if args.artifacts_base is not None else None,
    )
    try:
        app = build_single_graph_fastmcp(host, args.graph_id)
    except ValueError as e:
        print(f"graph-caster export-mcp: {e}", file=sys.stderr)
        return 2

    bind = str(getattr(args, "bind", "stdio") or "stdio").strip().lower()
    if bind == "http":
        port = int(getattr(args, "port", 8765) or 8765)
        app.run(transport="streamable-http", host="127.0.0.1", port=port)
    else:
        app.run(transport="stdio")
    return 0
