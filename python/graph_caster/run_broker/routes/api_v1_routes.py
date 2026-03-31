# Copyright Aura. All Rights Reserved.

from __future__ import annotations

import json
import logging
import os
from typing import Any

from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from graph_caster.run_broker.auth.api_key import APIKeyAuthenticator
from graph_caster.run_broker.routes.common import MAX_PERSISTED_EVENTS_BYTES
from graph_caster.run_broker.errors import PendingQueueFullError
from graph_caster.run_broker.registry import RunBrokerRegistry
from graph_caster.run_broker.registry_run_manager import BrokerRegistryRunManager
from graph_caster.run_broker.routes.api_v1 import (
    APIV1Handler,
    CancelResponse,
    RunRequest,
    RunResponse,
)
from graph_caster.run_broker.routes.api_v1_openapi import build_api_v1_openapi_document

logger = logging.getLogger(__name__)


def _load_api_v1_auth() -> APIKeyAuthenticator | None:
    raw = os.environ.get("GC_RUN_BROKER_V1_API_KEYS", "").strip()
    if not raw:
        return None
    auth = APIKeyAuthenticator()
    n = 0
    for entry in raw.split(","):
        entry = entry.strip()
        if ":" not in entry:
            continue
        kid, sec = entry.split(":", 1)
        kid, sec = kid.strip(), sec.strip()
        if not kid or not sec:
            continue
        auth.register_key(
            kid,
            sec,
            "v1-env",
            ["run:execute", "run:view", "run:cancel"],
        )
        n += 1
    return auth if n else None


def _run_response_body(r: RunResponse) -> dict[str, Any]:
    d: dict[str, Any] = {
        "runId": r.run_id,
        "graphId": r.graph_id,
        "status": r.status,
        "createdAt": r.created_at,
    }
    if r.outputs is not None:
        d["outputs"] = r.outputs
    if r.error is not None:
        d["error"] = r.error
    return d


def _cancel_body(c: CancelResponse) -> dict[str, Any]:
    return {
        "runId": c.run_id,
        "cancelled": c.cancelled,
        "message": c.message,
    }


def make_api_v1_routes(reg: RunBrokerRegistry) -> list[Route]:
    mgr = BrokerRegistryRunManager.from_env(reg)
    handler = APIV1Handler(mgr, auth=_load_api_v1_auth())

    async def post_graph_run(request: Request) -> Response:
        graph_id = request.path_params["graph_id"]
        try:
            body = await request.json()
            if not isinstance(body, dict):
                return JSONResponse({"error": "body must be object"}, status_code=400)
        except (json.JSONDecodeError, ValueError, TypeError):
            return JSONResponse({"error": "invalid JSON body"}, status_code=400)

        inputs = body.get("inputs")
        if inputs is None:
            inputs = {}
        if not isinstance(inputs, dict):
            return JSONResponse({"error": "inputs must be object"}, status_code=400)

        wait_raw = body.get("waitForCompletion")
        if wait_raw is None:
            wait_raw = body.get("wait_for_completion")
        wait = bool(wait_raw)

        timeout_raw = body.get("timeout", 300.0)
        try:
            timeout = float(timeout_raw)
        except (TypeError, ValueError):
            timeout = 300.0

        req = RunRequest(inputs=inputs, wait_for_completion=wait, timeout=timeout)
        auth_h = request.headers.get("Authorization")
        try:
            resp = await handler.start_run(graph_id, req, auth_header=auth_h)
        except PermissionError as e:
            return JSONResponse({"error": str(e)}, status_code=401)
        except FileNotFoundError as e:
            return JSONResponse({"error": str(e)}, status_code=404)
        except ValueError as e:
            msg = str(e)
            if "not configured" in msg:
                logger.warning("api v1 start_run config error: %s", e)
                return JSONResponse({"error": msg}, status_code=503)
            return JSONResponse({"error": msg}, status_code=400)
        except PendingQueueFullError:
            return JSONResponse({"error": "pending_queue_full"}, status_code=503)

        return JSONResponse(_run_response_body(resp))

    async def get_run(request: Request) -> Response:
        run_id = request.path_params["run_id"]
        auth_h = request.headers.get("Authorization")
        try:
            resp = await handler.get_run_status(run_id, auth_header=auth_h)
        except PermissionError as e:
            return JSONResponse({"error": str(e)}, status_code=401)
        except KeyError as e:
            return JSONResponse({"error": str(e)}, status_code=404)

        return JSONResponse(_run_response_body(resp))

    async def get_run_events(request: Request) -> Response:
        run_id = request.path_params["run_id"]
        auth_h = request.headers.get("Authorization")
        raw_mx = request.query_params.get("maxBytes")
        max_bytes = 1_000_000
        if raw_mx is not None and str(raw_mx).strip() != "":
            try:
                max_bytes = int(raw_mx)
            except (TypeError, ValueError):
                return JSONResponse(
                    {"error": "maxBytes query must be int"}, status_code=400
                )
        max_bytes = max(0, min(max_bytes, MAX_PERSISTED_EVENTS_BYTES))
        try:
            text, truncated = await handler.get_run_events(
                run_id, max_bytes=max_bytes, auth_header=auth_h
            )
        except PermissionError as e:
            return JSONResponse({"error": str(e)}, status_code=401)
        except KeyError as e:
            return JSONResponse({"error": str(e)}, status_code=404)

        return Response(
            content=text.encode("utf-8"),
            media_type="application/x-ndjson; charset=utf-8",
            headers={
                "X-GC-Events-Truncated": "true" if truncated else "false",
            },
        )

    async def post_cancel_run(request: Request) -> Response:
        run_id = request.path_params["run_id"]
        auth_h = request.headers.get("Authorization")
        try:
            resp = await handler.cancel_run(run_id, auth_header=auth_h)
        except PermissionError as e:
            return JSONResponse({"error": str(e)}, status_code=401)

        return JSONResponse(_cancel_body(resp))

    async def get_openapi_v1(_request: Request) -> Response:
        return JSONResponse(build_api_v1_openapi_document())

    return [
        Route(
            "/api/v1/openapi.json",
            get_openapi_v1,
            methods=["GET"],
        ),
        Route(
            "/api/v1/graphs/{graph_id}/run",
            post_graph_run,
            methods=["POST"],
        ),
        Route(
            "/api/v1/runs/{run_id}",
            get_run,
            methods=["GET"],
        ),
        Route(
            "/api/v1/runs/{run_id}/events",
            get_run_events,
            methods=["GET"],
        ),
        Route(
            "/api/v1/runs/{run_id}/cancel",
            post_cancel_run,
            methods=["POST"],
        ),
    ]
