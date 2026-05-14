# Copyright GraphCaster. All Rights Reserved.

"""REST routes for credentials management (UX47/48)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from graph_caster.credentials.store import CredentialStore
from graph_caster.auth.rbac import Principal, has_scope


def _get_principal(request: Request) -> Principal | None:
    return request.scope.get("principal")


def _require_scope(principal: Principal | None, scope: str) -> Response | None:
    if principal is None:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    if not has_scope(principal.effective_scopes, scope):
        return JSONResponse({"error": f"Forbidden: missing scope {scope!r}"}, status_code=403)
    return None


def _tenant_id(request: Request, principal: Principal | None) -> str:
    if principal is not None:
        return principal.tenant_id
    return request.headers.get("X-Tenant-Id", "default")


def _rec_response(rec: Any) -> dict[str, Any]:
    return rec.public_dict()


def make_credentials_routes(store: CredentialStore) -> list[Route]:

    async def list_credentials(request: Request) -> Response:
        p = _get_principal(request)
        denied = _require_scope(p, "credential:read")
        if denied:
            denied = _require_scope(p, "graph:view")
            if denied:
                return denied
        tid = _tenant_id(request, p)
        type_filter = request.query_params.get("type") or None
        search = request.query_params.get("search") or None
        recs = await store.list(tid, type_filter=type_filter, search=search)
        return JSONResponse({"credentials": [_rec_response(r) for r in recs]})

    async def get_credential(request: Request) -> Response:
        p = _get_principal(request)
        denied = _require_scope(p, "credential:read")
        if denied:
            return denied
        tid = _tenant_id(request, p)
        cred_id = request.path_params["cred_id"]
        rec = await store.get(cred_id, tid)
        if rec is None:
            return JSONResponse({"error": "Not found"}, status_code=404)
        return JSONResponse(_rec_response(rec))

    async def create_credential(request: Request) -> Response:
        p = _get_principal(request)
        denied = _require_scope(p, "credential:write")
        if denied:
            return denied
        tid = _tenant_id(request, p)
        try:
            body = await request.json()
        except (json.JSONDecodeError, ValueError):
            return JSONResponse({"error": "Invalid JSON"}, status_code=400)
        name = body.get("name", "").strip()
        ctype = body.get("type", "").strip()
        fields = body.get("fields", {})
        description = body.get("description", "")
        provider = body.get("provider", "file")
        if not name:
            return JSONResponse({"error": "name is required"}, status_code=400)
        if not ctype:
            return JSONResponse({"error": "type is required"}, status_code=400)
        if not isinstance(fields, dict):
            return JSONResponse({"error": "fields must be an object"}, status_code=400)
        try:
            rec = await store.create(
                tenant_id=tid,
                name=name,
                type=ctype,
                fields=fields,
                description=description,
                provider=provider,
            )
        except ValueError as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)

        from graph_caster.audit.audit_event import emit_async
        await emit_async(
            action="credential.create",
            actor=p.user_id if p else "anonymous",
            actor_kind="user",
            tenant_id=tid,
            target_kind="credential",
            target_id=rec.id,
            result="success",
            metadata={"name": rec.name, "type": rec.type},
        )
        return JSONResponse(_rec_response(rec), status_code=201)

    async def patch_credential(request: Request) -> Response:
        p = _get_principal(request)
        denied = _require_scope(p, "credential:write")
        if denied:
            return denied
        tid = _tenant_id(request, p)
        cred_id = request.path_params["cred_id"]
        try:
            body = await request.json()
        except (json.JSONDecodeError, ValueError):
            return JSONResponse({"error": "Invalid JSON"}, status_code=400)
        if not isinstance(body, dict):
            return JSONResponse({"error": "body must be object"}, status_code=400)
        try:
            rec = await store.update(cred_id, tid, body)
        except KeyError:
            return JSONResponse({"error": "Not found"}, status_code=404)
        return JSONResponse(_rec_response(rec))

    async def delete_credential(request: Request) -> Response:
        p = _get_principal(request)
        denied = _require_scope(p, "credential:write")
        if denied:
            return denied
        tid = _tenant_id(request, p)
        cred_id = request.path_params["cred_id"]
        rec = await store.get(cred_id, tid)
        if rec is None:
            return JSONResponse({"error": "Not found"}, status_code=404)
        await store.delete(cred_id, tid)

        from graph_caster.audit.audit_event import emit_async
        await emit_async(
            action="credential.delete",
            actor=p.user_id if p else "anonymous",
            actor_kind="user",
            tenant_id=tid,
            target_kind="credential",
            target_id=cred_id,
            result="success",
        )
        return Response(status_code=204)

    async def test_credential(request: Request) -> Response:
        p = _get_principal(request)
        denied = _require_scope(p, "credential:write")
        if denied:
            return denied
        tid = _tenant_id(request, p)
        cred_id = request.path_params["cred_id"]
        try:
            result = await store.test(cred_id, tid)
        except KeyError:
            return JSONResponse({"error": "Not found"}, status_code=404)

        from graph_caster.audit.audit_event import emit_async
        await emit_async(
            action="credential.use",
            actor=p.user_id if p else "anonymous",
            actor_kind="user",
            tenant_id=tid,
            target_kind="credential",
            target_id=cred_id,
            result="success" if result.get("ok") else "failure",
            metadata={"message": result.get("message", "")},
        )
        return JSONResponse(result)

    return [
        Route("/api/v1/credentials", list_credentials, methods=["GET"]),
        Route("/api/v1/credentials/{cred_id}", get_credential, methods=["GET"]),
        Route("/api/v1/credentials", create_credential, methods=["POST"]),
        Route("/api/v1/credentials/{cred_id}", patch_credential, methods=["PATCH"]),
        Route("/api/v1/credentials/{cred_id}", delete_credential, methods=["DELETE"]),
        Route("/api/v1/credentials/{cred_id}/test", test_credential, methods=["POST"]),
    ]
