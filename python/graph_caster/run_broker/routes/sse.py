# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from typing import TYPE_CHECKING

from starlette.requests import Request
from starlette.responses import JSONResponse, Response, StreamingResponse

from graph_caster.run_broker.registry import RunBrokerRegistry

if TYPE_CHECKING:
    from collections.abc import AsyncIterator


def _parse_since_seq(raw: str | None) -> int:
    if raw is None:
        return -1
    try:
        v = int(raw)
    except (TypeError, ValueError):
        return -1
    return v if v >= 0 else -1


def make_stream_run_handler(reg: RunBrokerRegistry):
    async def stream_run(request: Request) -> Response:
        run_id = request.path_params["run_id"]
        entry = reg.get(run_id)
        if entry is None:
            return JSONResponse({"error": "unknown run"}, status_code=404)

        since_seq = _parse_since_seq(request.query_params.get("since_seq"))
        if since_seq >= 0:
            q, replay = entry.broadcaster.subscribe_with_replay(since_seq)
        else:
            q, replay = entry.broadcaster.subscribe(), []

        async def gen() -> AsyncIterator[str]:
            # Drain replay buffer first so the client sees missed events before
            # any new live events. Uses the broadcaster's own SSE chunking.
            if replay:
                async for chunk in entry.broadcaster.stream_replay(replay):
                    yield chunk
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
