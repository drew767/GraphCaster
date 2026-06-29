"""`openapi` command — OpenAPI spec tools."""
from __future__ import annotations

import argparse


def register(sub: argparse._SubParsersAction) -> None:
    oa = sub.add_parser("openapi", help="OpenAPI / Swagger spec tools: inspect, list-operations, invoke")
    oa_sub = oa.add_subparsers(dest="openapi_command", required=True)

    oa_inspect = oa_sub.add_parser("inspect", help="Print parsed operations from a spec (JSON array)")
    oa_inspect.add_argument("spec", help="URL or path to OpenAPI JSON spec")
    oa_inspect.add_argument("--base-url", default=None, dest="base_url", help="Override base URL")

    oa_list = oa_sub.add_parser("list-operations", help="List operation IDs from a spec")
    oa_list.add_argument("spec", help="URL or path to OpenAPI JSON spec")
    oa_list.add_argument("--base-url", default=None, dest="base_url", help="Override base URL")

    oa_invoke = oa_sub.add_parser("invoke", help="Invoke a single operation from a spec")
    oa_invoke.add_argument("spec", help="URL or path to OpenAPI JSON spec")
    oa_invoke.add_argument("--op", required=True, dest="operation_id", help="operationId to invoke")
    oa_invoke.add_argument("--args", default="{}", dest="args_json", help="JSON object of arguments")
    oa_invoke.add_argument("--base-url", default=None, dest="base_url", help="Override base URL")
    oa_invoke.add_argument(
        "--timeout", type=float, default=30.0, dest="timeout_sec", help="Request timeout in seconds"
    )


def execute(args: argparse.Namespace) -> int:
    import asyncio as _asyncio
    import json
    import sys
    from graph_caster.tools.openapi_import import OpenAPIImporter, invoke_openapi_tool

    importer = OpenAPIImporter()
    spec_source: str = args.spec
    base_url_override: str | None = getattr(args, "base_url", None)

    async def _load():
        if spec_source.startswith("http://") or spec_source.startswith("https://"):
            return await importer.from_url(spec_source)
        from pathlib import Path as _Path
        return importer.from_file(_Path(spec_source))

    try:
        specs = _asyncio.run(_load())
    except Exception as exc:
        print(f"graph-caster openapi: failed to load spec: {exc}", file=sys.stderr)
        return 2

    if base_url_override:
        from graph_caster.tools.openapi_import import OpenAPIToolSpec, AuthSpec  # noqa: F401
        specs = [
            OpenAPIToolSpec(
                name=s.name, summary=s.summary, description=s.description,
                method=s.method, path=s.path, base_url=base_url_override.rstrip("/"),
                parameters=s.parameters, request_body=s.request_body,
                response_schema=s.response_schema, auth=s.auth,
                raw_operation=s.raw_operation,
            )
            for s in specs
        ]

    cmd = str(getattr(args, "openapi_command", ""))

    if cmd == "inspect":
        out = [
            {
                "name": s.name,
                "method": s.method,
                "path": s.path,
                "base_url": s.base_url,
                "summary": s.summary,
                "auth_kind": s.auth.kind,
                "parameters": [p.get("name") for p in s.parameters],
            }
            for s in specs
        ]
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return 0

    if cmd == "list-operations":
        for s in specs:
            print(f"{s.name}  {s.method}  {s.path}")
        return 0

    if cmd == "invoke":
        op_id: str = str(getattr(args, "operation_id", "")).strip()
        args_json: str = str(getattr(args, "args_json", "{}") or "{}")
        timeout_sec: float = float(getattr(args, "timeout_sec", 30.0) or 30.0)

        try:
            invoke_args = json.loads(args_json)
        except json.JSONDecodeError as exc:
            print(f"graph-caster openapi invoke: invalid --args JSON: {exc}", file=sys.stderr)
            return 2

        from graph_caster.tools.openapi_import import _sanitize_name
        target = _sanitize_name(op_id)
        op_spec = next(
            (s for s in specs if s.name == target or s.raw_operation.get("operationId") == op_id),
            None,
        )
        if op_spec is None:
            available = [s.name for s in specs]
            print(
                f"graph-caster openapi invoke: operationId {op_id!r} not found. Available: {available}",
                file=sys.stderr,
            )
            return 2

        async def _invoke():
            return await invoke_openapi_tool(op_spec, invoke_args, secrets_resolver=None, timeout_sec=timeout_sec)

        try:
            result = _asyncio.run(_invoke())
        except Exception as exc:
            print(f"graph-caster openapi invoke: {exc}", file=sys.stderr)
            return 2

        print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
        return 0

    return 2
