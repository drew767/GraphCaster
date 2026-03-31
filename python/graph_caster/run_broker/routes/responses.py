# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from typing import Any

from starlette.responses import JSONResponse

from graph_caster.run_broker.errors import PendingQueueFullError
from graph_caster.run_broker.registry import SpawnResult


def new_run_json(sp: SpawnResult) -> dict:
    return {
        "runId": sp.run_id,
        "viewerToken": sp.viewer_token,
        "runBroker": {"phase": sp.phase, "queuePosition": sp.queue_position},
    }


def graph_webhook_wait_json(sp: SpawnResult, wait_result: dict[str, Any]) -> dict[str, Any]:
    """JSON body for graph webhook when ``responseMode`` is **wait** (run finished or timed out)."""
    out: dict[str, Any] = {**new_run_json(sp), "status": wait_result.get("status", "unknown")}
    if wait_result.get("outputs") is not None:
        out["outputs"] = wait_result["outputs"]
    if wait_result.get("error") is not None:
        out["error"] = wait_result["error"]
    return out


def pending_queue_full_response() -> JSONResponse:
    return JSONResponse(
        {"error": "pending_queue_full", "message": PendingQueueFullError.default_message},
        status_code=503,
    )
