# Copyright GraphCaster. All Rights Reserved.

"""REST routes for user management (UX53)."""

from __future__ import annotations

import json
import os
import secrets
from typing import Any

from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from graph_caster.auth.rbac import Principal, has_scope, Role
from graph_caster.tenancy.models import User
from graph_caster.tenancy.service import TenantService


def _get_principal(request: Request) -> Principal | None:
    return request.scope.get("principal")


def _require_scope(principal: Principal | None, scope: str) -> Response | None:
    if principal is None:
        return JSONResponse({"error": "Unauthorized"}, status_code=401)
    if not has_scope(principal.effective_scopes, scope):
        return JSONResponse({"error": f"Forbidden: missing scope {scope!r}"}, status_code=403)
    return None


def _public_base_url() -> str:
    raw = os.environ.get("GC_PUBLIC_BASE_URL", "").strip()
    return raw.rstrip("/") if raw else "http://localhost:9847"


def _user_dict(user: User, role: str | None = None) -> dict[str, Any]:
    d: dict[str, Any] = {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "createdAt": user.created_at,
        "isActive": user.is_active,
    }
    if role is not None:
        d["role"] = role
    return d


def make_users_routes(tenant_service: TenantService) -> list[Route]:
    store = tenant_service._store

    async def list_users(request: Request) -> Response:
        p = _get_principal(request)
        denied = _require_scope(p, "user:read")
        if denied:
            denied2 = _require_scope(p, "admin")
            if denied2:
                return denied
        tid = p.tenant_id if p else "default"
        search = request.query_params.get("search", "").lower()
        role_filter = request.query_params.get("role", "").strip()

        memberships = await store.list_memberships(tid)
        results: list[dict[str, Any]] = []
        for m in memberships:
            if role_filter and m.role != role_filter:
                continue
            user = await store.get_user(m.user_id)
            if user is None:
                continue
            if search and search not in user.name.lower() and search not in user.email.lower():
                continue
            results.append(_user_dict(user, role=m.role))
        return JSONResponse({"users": results})

    async def get_me(request: Request) -> Response:
        p = _get_principal(request)
        if p is None:
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        user = await store.get_user(p.user_id)
        if user is None:
            return JSONResponse({"error": "User not found"}, status_code=404)
        m = await store.get_membership(p.user_id, p.tenant_id)
        role = m.role if m else str(p.role)
        return JSONResponse(_user_dict(user, role=role))

    async def patch_me(request: Request) -> Response:
        p = _get_principal(request)
        if p is None:
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        try:
            body = await request.json()
        except (json.JSONDecodeError, ValueError):
            return JSONResponse({"error": "Invalid JSON"}, status_code=400)
        user = await store.get_user(p.user_id)
        if user is None:
            return JSONResponse({"error": "User not found"}, status_code=404)
        if "first_name" in body or "last_name" in body:
            first = body.get("first_name", "")
            last = body.get("last_name", "")
            parts = [x for x in [first, last] if x]
            if parts:
                user.name = " ".join(parts)
        if "name" in body:
            user.name = str(body["name"])
        await store.update_user(user)
        m = await store.get_membership(p.user_id, p.tenant_id)
        return JSONResponse(_user_dict(user, role=m.role if m else str(p.role)))

    async def invite_user(request: Request) -> Response:
        p = _get_principal(request)
        denied = _require_scope(p, "user:invite")
        if denied:
            return denied
        tid = p.tenant_id if p else "default"
        try:
            body = await request.json()
        except (json.JSONDecodeError, ValueError):
            return JSONResponse({"error": "Invalid JSON"}, status_code=400)
        email = body.get("email", "").strip()
        role = body.get("role", "viewer").strip()
        if not email:
            return JSONResponse({"error": "email is required"}, status_code=400)
        valid_roles = {"owner", "admin", "editor", "viewer", "dataset_operator"}
        if role not in valid_roles:
            return JSONResponse({"error": f"Invalid role. Must be one of {sorted(valid_roles)}"}, status_code=400)

        token = await tenant_service.invite_member(tid, email, role)
        invite_url = f"{_public_base_url()}/accept-invite?token={token}"

        from graph_caster.audit.audit_event import emit_async
        await emit_async(
            action="user.invite",
            actor=p.user_id if p else "anonymous",
            actor_kind="user",
            tenant_id=tid,
            target_kind="user",
            target_id=email,
            result="success",
            metadata={"email": email, "role": role},
        )
        return JSONResponse({"invite_token": token, "invite_url": invite_url}, status_code=201)

    async def accept_invite(request: Request) -> Response:
        try:
            body = await request.json()
        except (json.JSONDecodeError, ValueError):
            return JSONResponse({"error": "Invalid JSON"}, status_code=400)
        token = body.get("token", "").strip()
        if not token:
            return JSONResponse({"error": "token is required"}, status_code=400)

        inv = await store.get_invite(token)
        if inv is None:
            return JSONResponse({"error": "Invalid or expired invite token"}, status_code=404)

        email = inv["email"]
        existing = await store.find_user_by_email(email)
        if existing is not None:
            user = existing
        else:
            from datetime import datetime, timezone
            import uuid as _uuid
            password = body.get("password")
            from graph_caster.tenancy.service import _hash_password
            pw_hash = _hash_password(password) if password else None
            user = User(
                id=str(_uuid.uuid4()),
                email=email,
                name=email.split("@")[0],
                created_at=datetime.now(timezone.utc).isoformat(),
                password_hash=pw_hash,
            )
            await store.create_user(user)

        from graph_caster.tenancy.service import InviteError
        try:
            m = await tenant_service.accept_invite(token, user)
        except InviteError as exc:
            return JSONResponse({"error": str(exc)}, status_code=400)

        return JSONResponse({"user": _user_dict(user, role=m.role), "tenant_id": m.tenant_id})

    async def patch_user_role(request: Request) -> Response:
        p = _get_principal(request)
        denied = _require_scope(p, "admin")
        if denied:
            return denied
        tid = p.tenant_id if p else "default"
        user_id = request.path_params["user_id"]
        try:
            body = await request.json()
        except (json.JSONDecodeError, ValueError):
            return JSONResponse({"error": "Invalid JSON"}, status_code=400)
        role = body.get("role", "").strip()
        valid_roles = {"owner", "admin", "editor", "viewer", "dataset_operator"}
        if role not in valid_roles:
            return JSONResponse({"error": f"Invalid role. Must be one of {sorted(valid_roles)}"}, status_code=400)
        try:
            await store.update_member_role(user_id, tid, role)
        except KeyError:
            return JSONResponse({"error": "User not found in tenant"}, status_code=404)
        return JSONResponse({"user_id": user_id, "role": role})

    async def delete_user(request: Request) -> Response:
        p = _get_principal(request)
        denied = _require_scope(p, "admin")
        if denied:
            return denied
        tid = p.tenant_id if p else "default"
        user_id = request.path_params["user_id"]
        if p and user_id == p.user_id:
            return JSONResponse({"error": "Cannot remove yourself"}, status_code=400)
        m = await store.get_membership(user_id, tid)
        if m is None:
            return JSONResponse({"error": "User not found in tenant"}, status_code=404)
        await store.remove_member(user_id, tid)
        return Response(status_code=204)

    async def reset_password(request: Request) -> Response:
        p = _get_principal(request)
        denied = _require_scope(p, "admin")
        if denied:
            return denied
        tid = p.tenant_id if p else "default"
        user_id = request.path_params["user_id"]
        m = await store.get_membership(user_id, tid)
        if m is None:
            return JSONResponse({"error": "User not found in tenant"}, status_code=404)
        user = await store.get_user(user_id)
        if user is None:
            return JSONResponse({"error": "User not found"}, status_code=404)
        temp_password = secrets.token_urlsafe(12)
        from graph_caster.tenancy.service import _hash_password
        user.password_hash = _hash_password(temp_password)
        await store.update_user(user)
        return JSONResponse({"temp_password": temp_password, "user_id": user_id})

    return [
        Route("/api/v1/users", list_users, methods=["GET"]),
        Route("/api/v1/users/me", get_me, methods=["GET"]),
        Route("/api/v1/users/me", patch_me, methods=["PATCH"]),
        Route("/api/v1/users/invite", invite_user, methods=["POST"]),
        Route("/api/v1/users/accept-invite", accept_invite, methods=["POST"]),
        Route("/api/v1/users/{user_id}", patch_user_role, methods=["PATCH"]),
        Route("/api/v1/users/{user_id}", delete_user, methods=["DELETE"]),
        Route("/api/v1/users/{user_id}/reset-password", reset_password, methods=["POST"]),
    ]
