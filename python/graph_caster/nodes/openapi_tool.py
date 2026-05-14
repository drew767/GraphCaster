# Copyright GraphCaster. All Rights Reserved.

"""openapi_tool node — auto-invokes a single OpenAPI operation per graph visit.

Parses the spec on first visit (cached in-process by URL/path + content hash),
finds the requested operation, and executes it via httpx.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, ClassVar

from graph_caster.node_api.base import GraphCasterNode
from graph_caster.node_api.fields import Input, Output
from graph_caster.node_api.registry import register_class
from graph_caster.tools.openapi_import import OpenAPIImporter, OpenAPIToolSpec, invoke_openapi_tool

_importer = OpenAPIImporter()


def _find_operation(specs: list[OpenAPIToolSpec], operation_id: str) -> OpenAPIToolSpec | None:
    """Find a spec by sanitized name or raw operationId (case-insensitive fallback)."""
    from graph_caster.tools.openapi_import import _sanitize_name

    target = _sanitize_name(operation_id)
    for s in specs:
        if s.name == target:
            return s
        raw_op_id = s.raw_operation.get("operationId", "")
        if raw_op_id == operation_id:
            return s
        if raw_op_id.lower() == operation_id.lower():
            return s
    return None


class OpenAPIToolNode(GraphCasterNode):
    """Invoke a single OpenAPI operation.

    On each visit the node:
    1. Loads and parses the spec (from URL or file path) — cached in-memory.
    2. Locates the requested operationId.
    3. Builds and fires the HTTP request via httpx.
    4. Returns status, parsed body, and response headers.
    """

    type: ClassVar[str] = "openapi_tool"
    version: ClassVar[float] = 1.0
    display_name: ClassVar[str] = "OpenAPI Tool"
    description: ClassVar[str] = "Auto-generated callable tool from an OpenAPI / Swagger spec."
    category: ClassVar[str] = "integration"
    icon: ClassVar[str] = "plug"

    inputs: ClassVar[list[Input]] = [
        Input(
            name="specSource",
            field_type=str,
            required=True,
            description="URL or file path pointing to an OpenAPI 3.x / Swagger 2.0 JSON spec.",
        ),
        Input(
            name="operationId",
            field_type=str,
            required=True,
            description="operationId (or sanitized name) of the operation to invoke.",
        ),
        Input(
            name="arguments",
            field_type="json",
            required=True,
            description="Dict of arguments for the operation (path params, query, body, etc.).",
        ),
        Input(
            name="baseUrlOverride",
            field_type=str,
            required=False,
            default="",
            description="If set, overrides the base URL from the spec servers list.",
        ),
    ]

    outputs: ClassVar[list[Output]] = [
        Output(name="status", field_type=int, description="HTTP response status code."),
        Output(name="body", field_type="json", description="Parsed response body (JSON or text)."),
        Output(name="headers", field_type="json", description="Response headers dict."),
    ]

    async def run(self, ctx: Any, **kwargs: Any) -> dict[str, Any]:
        spec_source: str = str(kwargs.get("specSource") or "").strip()
        operation_id: str = str(kwargs.get("operationId") or "").strip()
        arguments: Any = kwargs.get("arguments") or {}
        base_url_override: str = str(kwargs.get("baseUrlOverride") or "").strip()

        if not spec_source:
            raise ValueError("openapi_tool: 'specSource' is required")
        if not operation_id:
            raise ValueError("openapi_tool: 'operationId' is required")

        if isinstance(arguments, str):
            try:
                arguments = json.loads(arguments)
            except json.JSONDecodeError as exc:
                raise ValueError(f"openapi_tool: 'arguments' must be a JSON object: {exc}") from exc
        if not isinstance(arguments, dict):
            arguments = {}

        # Resolve spec — URL or file path
        if spec_source.startswith("http://") or spec_source.startswith("https://"):
            specs = await _importer.from_url(spec_source)
        else:
            path = Path(spec_source)
            if not path.exists():
                raise ValueError(f"openapi_tool: spec file not found: {spec_source!r}")
            specs = _importer.from_file(path)

        # Apply base URL override after parsing
        if base_url_override:
            specs = [
                OpenAPIToolSpec(
                    name=s.name,
                    summary=s.summary,
                    description=s.description,
                    method=s.method,
                    path=s.path,
                    base_url=base_url_override.rstrip("/"),
                    parameters=s.parameters,
                    request_body=s.request_body,
                    response_schema=s.response_schema,
                    auth=s.auth,
                    raw_operation=s.raw_operation,
                )
                for s in specs
            ]

        op_spec = _find_operation(specs, operation_id)
        if op_spec is None:
            available = [s.name for s in specs]
            raise ValueError(
                f"openapi_tool: operationId {operation_id!r} not found in spec. "
                f"Available: {available}"
            )

        # Resolve secrets provider from ctx if available
        secrets_resolver: Any = None
        if isinstance(ctx, dict):
            secrets_resolver = ctx.get("secrets_provider")
        elif hasattr(ctx, "secrets"):
            secrets_resolver = ctx.secrets

        result = await invoke_openapi_tool(
            op_spec,
            arguments,
            secrets_resolver=secrets_resolver,
        )

        return {
            "status": result["status"],
            "body": result["body"],
            "headers": result["headers"],
        }


register_class(OpenAPIToolNode)
