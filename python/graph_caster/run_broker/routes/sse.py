# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from typing import TYPE_CHECKING

from starlette.requests import Request
from starlette.responses import JSONResponse, Response, StreamingResponse

from graph_caster.run_broker.registry import RunBrokerRegistry

if TYPE_CHECKING:
    from collections.abc import AsyncIterator


def make_stream_run_handler(reg: RunBrokerRegistry):
    async def stream_run(request: Request) -> Response:
        run_id = request.path_params["run_id"]
        entry = reg.get(run_id)
        if entry is None:
            return JSONResponse({"error": "unknown run"}, status_code=404)

        q = entry.broadcaster.subscribe()

        async def gen() -> AsyncIterator[str]:
            async for chunk in entry.broadcaster.stream_queue(q):
                yield chunk

        return StreamingResponse(
            gen(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    return stream_run
