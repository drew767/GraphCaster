# Copyright GraphCaster. All Rights Reserved.

"""REST routes for API key management (UX54)."""

from __future__ import annotations

import json
from typing import Any

from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from graph_caster.auth.api_keys import ApiKeyStore
from graph_caster.auth.rbac import Principal, has_scope


def _get_principal(request: Request) -> Principal | None:
    return request.scope.get("principal")


def _require_auth(principal: Principal | None) -> Response | None:
    if principal is None:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    return None


def make_api_keys_routes(store: ApiKeyStore) -> list[Route]:

    async def list_api_keys(request: Request) -> Response:
        p = _get_principal(request)
        denied = _require_auth(p)
        if denied:
            return denied
        keys = await store.list(p.user_id, p.tenant_id)
        return JSONResponse({"api_keys": [k.public_dict() for k in keys]})

    async def create_api_key(request: Request) -> Response:
        p = _get_principal(request)
        denied = _require_auth(p)
        if denied:
            return denied
        try:
            body = await request.json()
        except (json.JSONDecodeError, ValueError):
            return JSONResponse({"error": "Invalid JSON"}, status_code=400)
        label = body.get("label", "").strip()
        scopes = body.get("scopes", [])
        if not label:
            return JSONResponse({"error": "label is required"}, status_code=400)
        if not isinstance(scopes, list):
            return JSONResponse({"error": "scopes must be a list"}, status_code=400)

        rec, raw_key = await store.create(p.user_id, p.tenant_id, label, scopes)

        from graph_caster.audit.audit_event import emit_async
        await emit_async(
            action="api_key.create",
            actor=p.user_id,
            actor_kind="user",
            tenant_id=p.tenant_id,
            target_kind="api_key",
            target_id=rec.id,
            result="success",
            metadata={"label": label, "scopes": scopes},
        )
        return JSONResponse(
            {"api_key": rec.public_dict(), "raw_key": raw_key},
            status_code=201,
        )

    async def revoke_api_key(request: Request) -> Response:
        p = _get_principal(request)
        denied = _require_auth(p)
        if denied:
            return denied
        kid = request.path_params["key_id"]
        try:
            await store.revoke(kid, p.user_id, p.tenant_id)
        except PermissionError as exc:
            return JSONResponse({"error": str(exc)}, status_code=403)

        from graph_caster.audit.audit_event import emit_async
        await emit_async(
            action="api_key.revoke",
            actor=p.user_id,
            actor_kind="user",
            tenant_id=p.tenant_id,
            target_kind="api_key",
            target_id=kid,
            result="success",
        )
        return Response(status_code=204)

    return [
        Route("/api/v1/api-keys", list_api_keys, methods=["GET"]),
        Route("/api/v1/api-keys", create_api_key, methods=["POST"]),
        Route("/api/v1/api-keys/{key_id}", revoke_api_key, methods=["DELETE"]),
    ]
