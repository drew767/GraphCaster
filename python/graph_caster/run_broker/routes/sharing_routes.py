# Copyright GraphCaster. All Rights Reserved.

"""F86 — REST API routes for public sharing links."""

from __future__ import annotations

import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from graph_caster.sharing import (
    ShareLink,
    ShareLinkExhaustedError,
    ShareLinkExpiredError,
    ShareLinkNotFoundError,
    ShareLinkStore,
    _RateLimiter,
    _rate_limit_default,
    get_rate_limiter,
)

_PUBLIC_BASE_URL_ENV = "GC_PUBLIC_BASE_URL"
_DEFAULT_BASE_URL = "http://localhost:9847"


def _base_url() -> str:
    raw = os.environ.get(_PUBLIC_BASE_URL_ENV, "").strip()
    return raw.rstrip("/") if raw else _DEFAULT_BASE_URL


def _link_url(link_id: str) -> str:
    return f"{_base_url()}/api/v1/public/{link_id}"


def _link_response(lnk: ShareLink) -> dict[str, Any]:
    d = lnk.to_dict()
    d["url"] = _link_url(lnk.id)
    return d


def _check_management_auth(request: Request) -> bool:
    """Simple auth check for management endpoints. Returns True when auth passes."""
    auth_h = request.headers.get("Authorization", "").strip()
    if not auth_h:
        return False
    return True


def make_sharing_routes(
    store: ShareLinkStore,
    run_manager: Any,
    *,
    rate_limiter: _RateLimiter | None = None,
    rate_limit: int | None = None,
) -> list[Route]:
    rl = rate_limiter if rate_limiter is not None else get_rate_limiter()
    limit = rate_limit if rate_limit is not None else _rate_limit_default()

    _run_link_map: dict[str, str] = {}

    def _check_rate_limit(link_id: str) -> Response | None:
        allowed, retry_after = rl.check(link_id, limit)
        if not allowed:
            secs = max(1, math.ceil(retry_after))
            return JSONResponse(
                {"error": "rate_limit_exceeded", "retryAfter": secs},
                status_code=429,
                headers={"Retry-After": str(secs)},
            )
        return None

    async def post_graph_share(request: Request) -> Response:
        """POST /api/v1/graphs/{graph_id}/share — create a share link."""
        graph_id = request.path_params["graph_id"]
        if not _check_management_auth(request):
            return JSONResponse({"error": "authorization required"}, status_code=401)
        try:
            body = await request.json()
            if not isinstance(body, dict):
                return JSONResponse({"error": "body must be object"}, status_code=400)
        except (json.JSONDecodeError, ValueError, TypeError):
            return JSONResponse({"error": "invalid JSON body"}, status_code=400)

        permissions = body.get("permissions")
        if permissions not in ("view", "run", "view-and-run"):
            return JSONResponse(
                {"error": "permissions must be one of: view, run, view-and-run"},
                status_code=400,
            )

        expires_at = body.get("expires_at") or body.get("expiresAt")
        max_uses_raw = body.get("max_uses") if body.get("max_uses") is not None else body.get("maxUses")
        max_uses: int | None = None
        if max_uses_raw is not None:
            try:
                max_uses = int(max_uses_raw)
            except (TypeError, ValueError):
                return JSONResponse({"error": "max_uses must be integer"}, status_code=400)

        version_raw = body.get("version")
        graph_version: int | None = None
        if version_raw is not None:
            try:
                graph_version = int(version_raw)
            except (TypeError, ValueError):
                return JSONResponse({"error": "version must be integer"}, status_code=400)

        metadata = body.get("metadata") or {}
        if not isinstance(metadata, dict):
            metadata = {}

        auth_h = request.headers.get("Authorization", "")
        created_by = auth_h.replace("Bearer ", "").strip() if auth_h else ""

        lnk = ShareLink(
            id="",
            graph_id=graph_id,
            graph_version=graph_version,
            permissions=permissions,
            expires_at=expires_at,
            max_uses=max_uses,
            uses=0,
            created_by=created_by,
            created_at="",
            metadata=metadata,
        )
        created = await store.create(lnk)
        return JSONResponse(_link_response(created), status_code=201)

    async def get_graph_shares(request: Request) -> Response:
        """GET /api/v1/graphs/{graph_id}/shares — list share links for a graph."""
        graph_id = request.path_params["graph_id"]
        if not _check_management_auth(request):
            return JSONResponse({"error": "authorization required"}, status_code=401)
        links = await store.list_for_graph(graph_id)
        return JSONResponse({"links": [_link_response(lnk) for lnk in links]})

    async def delete_share_link(request: Request) -> Response:
        """DELETE /api/v1/shares/{link_id} — revoke a share link."""
        link_id = request.path_params["link_id"]
        if not _check_management_auth(request):
            return JSONResponse({"error": "authorization required"}, status_code=401)
        try:
            await store.revoke(link_id)
        except ShareLinkNotFoundError:
            return JSONResponse({"error": f"Share link not found: {link_id}"}, status_code=404)
        return JSONResponse({"revoked": link_id})

    async def get_public_landing(request: Request) -> Response:
        """GET /api/v1/public/{link_id} — public landing; no auth required."""
        link_id = request.path_params["link_id"]

        rate_resp = _check_rate_limit(link_id)
        if rate_resp is not None:
            return rate_resp

        lnk = await store.get(link_id)
        if lnk is None:
            return JSONResponse({"error": "Share link not found"}, status_code=404)
        if lnk.is_expired() or lnk.is_exhausted():
            return JSONResponse({"error": "Share link has expired or reached max uses"}, status_code=410)

        return JSONResponse({
            "graphId": lnk.graph_id,
            "version": lnk.graph_version,
            "permissions": lnk.permissions,
            "expiresAt": lnk.expires_at,
            "maxUses": lnk.max_uses,
            "uses": lnk.uses,
            "metadata": lnk.metadata,
            "url": _link_url(link_id),
        })

    async def post_public_run(request: Request) -> Response:
        """POST /api/v1/public/{link_id}/run — start a run via a share link."""
        link_id = request.path_params["link_id"]

        rate_resp = _check_rate_limit(link_id)
        if rate_resp is not None:
            return rate_resp

        lnk = await store.get(link_id)
        if lnk is None:
            return JSONResponse({"error": "Share link not found"}, status_code=404)
        if lnk.is_expired():
            return JSONResponse({"error": "Share link has expired"}, status_code=410)
        if lnk.is_exhausted():
            return JSONResponse({"error": "Share link has reached max uses"}, status_code=410)

        if not lnk.allows_run():
            return JSONResponse(
                {"error": "This share link does not grant run permission"},
                status_code=403,
            )

        try:
            body = await request.json()
            if not isinstance(body, dict):
                body = {}
        except (json.JSONDecodeError, ValueError, TypeError):
            body = {}

        inputs = body.get("inputs") or {}

        try:
            consumed = await store.consume(link_id)
        except ShareLinkExpiredError:
            return JSONResponse({"error": "Share link has expired"}, status_code=410)
        except ShareLinkExhaustedError:
            return JSONResponse({"error": "Share link has reached max uses"}, status_code=410)
        except ShareLinkNotFoundError:
            return JSONResponse({"error": "Share link not found"}, status_code=404)

        trigger_ctx = {
            "type": "share",
            "link_id": link_id,
            "graph_id": lnk.graph_id,
            "inputs": inputs,
        }
        run_id = await run_manager.start_run(
            lnk.graph_id,
            context=inputs,
            trigger_context=trigger_ctx,
        )

        _run_link_map[run_id] = link_id

        _emit_audit(link_id=link_id, graph_id=lnk.graph_id, action="share.access", run_id=run_id)

        return JSONResponse({"runId": run_id, "linkId": link_id, "graphId": lnk.graph_id})

    async def get_public_run_events(request: Request) -> Response:
        """GET /api/v1/public/{link_id}/runs/{run_id}/events — SSE events for a public run."""
        link_id = request.path_params["link_id"]
        run_id = request.path_params["run_id"]

        rate_resp = _check_rate_limit(link_id)
        if rate_resp is not None:
            return rate_resp

        lnk = await store.get(link_id)
        if lnk is None:
            return JSONResponse({"error": "Share link not found"}, status_code=404)

        if _run_link_map.get(run_id) != link_id:
            return JSONResponse(
                {"error": "Run not found or not associated with this share link"},
                status_code=404,
            )

        result = await run_manager.get_run_events_ndjson(run_id, 1_000_000)
        if result is None:
            return JSONResponse({"error": "Run not found"}, status_code=404)
        text, truncated = result
        return Response(
            content=text.encode("utf-8"),
            media_type="application/x-ndjson; charset=utf-8",
            headers={"X-GC-Events-Truncated": "true" if truncated else "false"},
        )

    return [
        Route(
            "/api/v1/graphs/{graph_id}/share",
            post_graph_share,
            methods=["POST"],
        ),
        Route(
            "/api/v1/graphs/{graph_id}/shares",
            get_graph_shares,
            methods=["GET"],
        ),
        Route(
            "/api/v1/shares/{link_id}",
            delete_share_link,
            methods=["DELETE"],
        ),
        Route(
            "/api/v1/public/{link_id}",
            get_public_landing,
            methods=["GET"],
        ),
        Route(
            "/api/v1/public/{link_id}/run",
            post_public_run,
            methods=["POST"],
        ),
        Route(
            "/api/v1/public/{link_id}/runs/{run_id}/events",
            get_public_run_events,
            methods=["GET"],
        ),
    ]


def _emit_audit(*, link_id: str, graph_id: str, action: str, run_id: str | None = None) -> None:
    """Emit a share.access audit event if audit log is configured."""
    try:
        import os as _os
        log_path_raw = _os.environ.get("GC_AUDIT_LOG_PATH", "").strip()
        auto = _os.environ.get("GC_AUDIT_LOG_AUTO", "").strip() == "1"
        if not log_path_raw and not auto:
            return
        payload: dict[str, Any] = {
            "action": action,
            "target_kind": "share_link",
            "target_id": link_id,
            "graph_id": graph_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        if run_id:
            payload["run_id"] = run_id
        from graph_caster.run_audit import append_run_finished_audit_maybe
        append_run_finished_audit_maybe(payload, workspace_root=None)
    except Exception:
        pass
