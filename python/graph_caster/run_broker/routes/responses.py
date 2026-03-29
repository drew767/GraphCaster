# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from starlette.responses import JSONResponse

from graph_caster.run_broker.errors import PendingQueueFullError
from graph_caster.run_broker.registry import SpawnResult


def new_run_json(sp: SpawnResult) -> dict:
    return {
        "runId": sp.run_id,
        "viewerToken": sp.viewer_token,
        "runBroker": {"phase": sp.phase, "queuePosition": sp.queue_position},
    }


def pending_queue_full_response() -> JSONResponse:
    return JSONResponse(
        {"error": "pending_queue_full", "message": PendingQueueFullError.default_message},
        status_code=503,
    )
