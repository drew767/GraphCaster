# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import sys

from graph_caster.cli._registry import build_parser, dispatch


_SUBCOMMANDS = frozenset(
    {
        "run",
        "artifacts-size",
        "artifacts-clear",
        "catalog-rebuild",
        "serve",
        "worker",
        "mcp",
        "mcp-oauth",
        "export-mcp",
        "kb",
        "vars",
        "composio",
        "export-dataset",
        "rag",
        "publish",
        "versions",
        "rollback",
        "ai-build",
        "ai-refine",
        "openapi",
        "tools",
        "audit",
        "tenant",
        "user",
        "member",
        "auth",
        "replay",
        "rbac",
        "collab",
        "plugin",
        "registry",
        "share",
        "resume",
    }
)


def _normalize_argv(argv: list[str]) -> list[str]:
    if not argv:
        return argv
    if argv[0] in _SUBCOMMANDS or argv[0] in ("-h", "--help"):
        return argv
    if "-d" in argv or "--document" in argv:
        return ["run"] + argv
    return argv


def main(argv: list[str] | None = None) -> int:
    if argv is None:
        argv = list(sys.argv[1:])
    if not argv:
        build_parser().print_help()
        return 0
    parser = build_parser()
    args = parser.parse_args(_normalize_argv(argv))
    return dispatch(args)


if __name__ == "__main__":
    raise SystemExit(main())
