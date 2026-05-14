# Copyright GraphCaster. All Rights Reserved.

"""REST routes for Projects API (F83 extension).

Scopes: project:read, project:write.
"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from graph_caster.projects.store import GCProject, ProjectStore


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _tenant_id_from_request(request: Request) -> str:
    """Extract tenant_id from header or fall back to 'default'."""
    return request.headers.get("X-Tenant-Id", "default").strip() or "default"


def _user_id_from_request(request: Request) -> str:
    """Extract acting user from Authorization header (bare token used as user_id)."""
    auth = request.headers.get("Authorization", "").strip()
    if auth.startswith("Bearer "):
        return auth[len("Bearer "):]
    return auth or "local"


def make_projects_routes(store: ProjectStore) -> list[Route]:
    """Return Starlette Route list for /api/v1/projects endpoints."""

    async def list_projects(request: Request) -> Response:
        tenant_id = _tenant_id_from_request(request)
        projects = await store.list(tenant_id)
        return JSONResponse({"projects": [p.to_dict() for p in projects]})

    async def create_project(request: Request) -> Response:
        tenant_id = _tenant_id_from_request(request)
        try:
            body = await request.json()
            if not isinstance(body, dict):
                return JSONResponse({"error": "body must be object"}, status_code=400)
        except (json.JSONDecodeError, ValueError, TypeError):
            return JSONResponse({"error": "invalid JSON body"}, status_code=400)

        name = str(body.get("name", "")).strip()
        if not name:
            return JSONResponse({"error": "name is required"}, status_code=400)

        now = _utcnow()
        project = GCProject(
            id=str(uuid.uuid4()),
            tenant_id=tenant_id,
            name=name,
            description=str(body.get("description") or ""),
            color=body.get("color"),
            created_at=now,
            updated_at=now,
        )
        created = await store.create(project)
        return JSONResponse(created.to_dict(), status_code=201)

    async def get_project(request: Request) -> Response:
        project_id = request.path_params["project_id"]
        tenant_id = _tenant_id_from_request(request)
        p = await store.get(project_id, tenant_id)
        if p is None:
            return JSONResponse({"error": f"Project {project_id!r} not found"}, status_code=404)
        return JSONResponse(p.to_dict())

    async def patch_project(request: Request) -> Response:
        project_id = request.path_params["project_id"]
        tenant_id = _tenant_id_from_request(request)
        p = await store.get(project_id, tenant_id)
        if p is None:
            return JSONResponse({"error": f"Project {project_id!r} not found"}, status_code=404)
        try:
            body = await request.json()
            if not isinstance(body, dict):
                return JSONResponse({"error": "body must be object"}, status_code=400)
        except (json.JSONDecodeError, ValueError, TypeError):
            return JSONResponse({"error": "invalid JSON body"}, status_code=400)

        if "name" in body:
            n = str(body["name"]).strip()
            if not n:
                return JSONResponse({"error": "name must not be empty"}, status_code=400)
            p.name = n
        if "description" in body:
            p.description = str(body["description"] or "")
        if "color" in body:
            p.color = body["color"]

        updated = await store.update(p)
        return JSONResponse(updated.to_dict())

    async def delete_project(request: Request) -> Response:
        project_id = request.path_params["project_id"]
        tenant_id = _tenant_id_from_request(request)
        p = await store.get(project_id, tenant_id)
        if p is None:
            return JSONResponse({"error": f"Project {project_id!r} not found"}, status_code=404)
        await store.delete(project_id, tenant_id)
        return JSONResponse({"deleted": project_id})

    async def list_members(request: Request) -> Response:
        project_id = request.path_params["project_id"]
        tenant_id = _tenant_id_from_request(request)
        p = await store.get(project_id, tenant_id)
        if p is None:
            return JSONResponse({"error": f"Project {project_id!r} not found"}, status_code=404)
        members = await store.list_members(project_id)
        return JSONResponse({"members": [m.to_dict() for m in members]})

    async def invite_member(request: Request) -> Response:
        project_id = request.path_params["project_id"]
        tenant_id = _tenant_id_from_request(request)
        p = await store.get(project_id, tenant_id)
        if p is None:
            return JSONResponse({"error": f"Project {project_id!r} not found"}, status_code=404)
        try:
            body = await request.json()
            if not isinstance(body, dict):
                return JSONResponse({"error": "body must be object"}, status_code=400)
        except (json.JSONDecodeError, ValueError, TypeError):
            return JSONResponse({"error": "invalid JSON body"}, status_code=400)

        email = str(body.get("email", "")).strip()
        role = str(body.get("role", "viewer")).strip()
        if not email:
            return JSONResponse({"error": "email is required"}, status_code=400)
        if role not in ("owner", "admin", "editor", "viewer"):
            return JSONResponse({"error": f"Invalid role: {role!r}"}, status_code=400)

        user_id = str(uuid.uuid5(uuid.NAMESPACE_X500, email))
        try:
            await store.add_member(project_id, user_id, role)
        except ValueError as e:
            return JSONResponse({"error": str(e)}, status_code=400)
        return JSONResponse({"projectId": project_id, "userId": user_id, "role": role}, status_code=201)

    async def remove_member(request: Request) -> Response:
        project_id = request.path_params["project_id"]
        user_id = request.path_params["user_id"]
        tenant_id = _tenant_id_from_request(request)
        p = await store.get(project_id, tenant_id)
        if p is None:
            return JSONResponse({"error": f"Project {project_id!r} not found"}, status_code=404)
        await store.remove_member(project_id, user_id)
        return JSONResponse({"removed": user_id})

    async def list_workflows(request: Request) -> Response:
        project_id = request.path_params["project_id"]
        tenant_id = _tenant_id_from_request(request)
        p = await store.get(project_id, tenant_id)
        if p is None:
            return JSONResponse({"error": f"Project {project_id!r} not found"}, status_code=404)
        resources = await store.get_resources(project_id)
        return JSONResponse({"workflows": resources.get("workflows", [])})

    async def list_credentials(request: Request) -> Response:
        project_id = request.path_params["project_id"]
        tenant_id = _tenant_id_from_request(request)
        p = await store.get(project_id, tenant_id)
        if p is None:
            return JSONResponse({"error": f"Project {project_id!r} not found"}, status_code=404)
        resources = await store.get_resources(project_id)
        return JSONResponse({"credentials": resources.get("credentials", [])})

    async def list_variables(request: Request) -> Response:
        project_id = request.path_params["project_id"]
        tenant_id = _tenant_id_from_request(request)
        p = await store.get(project_id, tenant_id)
        if p is None:
            return JSONResponse({"error": f"Project {project_id!r} not found"}, status_code=404)
        resources = await store.get_resources(project_id)
        return JSONResponse({"variables": resources.get("variables", [])})

    return [
        Route("/api/v1/projects", list_projects, methods=["GET"]),
        Route("/api/v1/projects", create_project, methods=["POST"]),
        Route("/api/v1/projects/{project_id}", get_project, methods=["GET"]),
        Route("/api/v1/projects/{project_id}", patch_project, methods=["PATCH"]),
        Route("/api/v1/projects/{project_id}", delete_project, methods=["DELETE"]),
        Route("/api/v1/projects/{project_id}/members", list_members, methods=["GET"]),
        Route("/api/v1/projects/{project_id}/members/invite", invite_member, methods=["POST"]),
        Route("/api/v1/projects/{project_id}/members/{user_id}", remove_member, methods=["DELETE"]),
        Route("/api/v1/projects/{project_id}/workflows", list_workflows, methods=["GET"]),
        Route("/api/v1/projects/{project_id}/credentials", list_credentials, methods=["GET"]),
        Route("/api/v1/projects/{project_id}/variables", list_variables, methods=["GET"]),
    ]
