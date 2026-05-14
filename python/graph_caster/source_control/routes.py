# Copyright GraphCaster. All Rights Reserved.

"""REST routes for Source Control API (UX57 / F49 extension).

Scopes: source_control:read, source_control:write.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from graph_caster.source_control.git_ops import GitCommandError, SourceControlManager


def _check_auth(request: Request) -> bool:
    return bool(request.headers.get("Authorization", "").strip())


def make_source_control_routes(manager: SourceControlManager) -> list[Route]:
    """Return Starlette Route list for /api/v1/source-control endpoints."""

    async def get_status(request: Request) -> Response:
        if not _check_auth(request):
            return JSONResponse({"error": "authorization required"}, status_code=401)
        try:
            status = await manager.get_status()
        except Exception as exc:
            return JSONResponse({"error": str(exc)}, status_code=500)
        return JSONResponse(status)

    async def post_connect(request: Request) -> Response:
        if not _check_auth(request):
            return JSONResponse({"error": "authorization required"}, status_code=401)
        try:
            body = await request.json()
            if not isinstance(body, dict):
                return JSONResponse({"error": "body must be object"}, status_code=400)
        except (json.JSONDecodeError, ValueError, TypeError):
            return JSONResponse({"error": "invalid JSON body"}, status_code=400)

        repo_url = str(body.get("repo_url", "")).strip()
        branch = str(body.get("branch", "main")).strip() or "main"
        auth = body.get("auth") or {}
        if not isinstance(auth, dict):
            auth = {}

        if not repo_url:
            return JSONResponse({"error": "repo_url is required"}, status_code=400)

        try:
            await manager.connect(repo_url, branch, auth)
        except GitCommandError as exc:
            return JSONResponse({"error": str(exc)}, status_code=502)
        except Exception as exc:
            return JSONResponse({"error": str(exc)}, status_code=500)

        return JSONResponse({"connected": True, "repo_url": repo_url, "branch": branch})

    async def post_disconnect(request: Request) -> Response:
        if not _check_auth(request):
            return JSONResponse({"error": "authorization required"}, status_code=401)
        try:
            await manager.disconnect()
        except Exception as exc:
            return JSONResponse({"error": str(exc)}, status_code=500)
        return JSONResponse({"disconnected": True})

    async def get_branches(request: Request) -> Response:
        if not _check_auth(request):
            return JSONResponse({"error": "authorization required"}, status_code=401)
        try:
            branches = await manager.list_branches()
        except Exception as exc:
            return JSONResponse({"error": str(exc)}, status_code=500)
        return JSONResponse({"branches": branches})

    async def post_pull(request: Request) -> Response:
        if not _check_auth(request):
            return JSONResponse({"error": "authorization required"}, status_code=401)
        try:
            body = await request.json()
            if not isinstance(body, dict):
                body = {}
        except (json.JSONDecodeError, ValueError, TypeError):
            body = {}
        force = bool(body.get("force", False))
        try:
            result = await manager.pull(force=force)
        except GitCommandError as exc:
            return JSONResponse({"error": str(exc)}, status_code=502)
        except Exception as exc:
            return JSONResponse({"error": str(exc)}, status_code=500)
        return JSONResponse(result)

    async def post_push(request: Request) -> Response:
        if not _check_auth(request):
            return JSONResponse({"error": "authorization required"}, status_code=401)
        try:
            body = await request.json()
            if not isinstance(body, dict):
                return JSONResponse({"error": "body must be object"}, status_code=400)
        except (json.JSONDecodeError, ValueError, TypeError):
            return JSONResponse({"error": "invalid JSON body"}, status_code=400)

        message = str(body.get("message", "")).strip() or "chore: graph-caster sync"
        files = body.get("files")
        if files is None:
            files = []
        if not isinstance(files, list):
            return JSONResponse({"error": "files must be array"}, status_code=400)
        force = bool(body.get("force", False))
        try:
            result = await manager.push(message, files, force=force)
        except GitCommandError as exc:
            return JSONResponse({"error": str(exc)}, status_code=502)
        except Exception as exc:
            return JSONResponse({"error": str(exc)}, status_code=500)
        return JSONResponse(result)

    async def get_history(request: Request) -> Response:
        if not _check_auth(request):
            return JSONResponse({"error": "authorization required"}, status_code=401)
        limit_raw = request.query_params.get("limit", "50")
        try:
            limit = max(1, min(int(limit_raw), 500))
        except (TypeError, ValueError):
            limit = 50
        try:
            commits = await manager.get_history(limit=limit)
        except Exception as exc:
            return JSONResponse({"error": str(exc)}, status_code=500)
        return JSONResponse({"commits": [c.to_dict() for c in commits]})

    async def get_diff(request: Request) -> Response:
        if not _check_auth(request):
            return JSONResponse({"error": "authorization required"}, status_code=401)
        a = request.query_params.get("a", "").strip()
        b = request.query_params.get("b", "").strip()
        if not a or not b:
            return JSONResponse({"error": "query params 'a' and 'b' are required"}, status_code=400)
        try:
            result = await manager.diff(a, b)
        except GitCommandError as exc:
            return JSONResponse({"error": str(exc)}, status_code=422)
        except Exception as exc:
            return JSONResponse({"error": str(exc)}, status_code=500)
        return JSONResponse(result)

    return [
        Route("/api/v1/source-control/status", get_status, methods=["GET"]),
        Route("/api/v1/source-control/connect", post_connect, methods=["POST"]),
        Route("/api/v1/source-control/disconnect", post_disconnect, methods=["POST"]),
        Route("/api/v1/source-control/branches", get_branches, methods=["GET"]),
        Route("/api/v1/source-control/pull", post_pull, methods=["POST"]),
        Route("/api/v1/source-control/push", post_push, methods=["POST"]),
        Route("/api/v1/source-control/history", get_history, methods=["GET"]),
        Route("/api/v1/source-control/diff", get_diff, methods=["GET"]),
    ]
