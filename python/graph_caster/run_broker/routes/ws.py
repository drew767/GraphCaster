# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import asyncio
import json
import logging
import os

from starlette.websockets import WebSocket, WebSocketDisconnect

from graph_caster.run_broker.registry import RunBrokerRegistry
from graph_caster.run_broker.routes.common import (
    WS_CLOSE_DEV_TOKEN,
    WS_CLOSE_UNKNOWN_RUN,
    WS_CLOSE_VIEWER_REJECT,
    broker_ws_token_ok,
    const_time_str_eq,
)
from graph_caster.run_transport.ws_envelope import broker_ws_payload_from_fanout

_LOG = logging.getLogger(__name__)


def make_ws_run_handler(reg: RunBrokerRegistry):
    async def ws_run(websocket: WebSocket) -> None:
        secret = os.environ.get("GC_RUN_BROKER_TOKEN", "").strip()
        if secret and not broker_ws_token_ok(websocket, secret):
            await websocket.close(code=WS_CLOSE_DEV_TOKEN)
            return
        run_id = websocket.path_params["run_id"]
        entry = reg.get(run_id)
        vt = (
            websocket.query_params.get("viewerToken") or websocket.query_params.get("pushRef") or ""
        ).strip()
        if entry is None:
            await websocket.close(code=WS_CLOSE_UNKNOWN_RUN)
            return
        if not const_time_str_eq(vt, entry.viewer_token):
            await websocket.close(code=WS_CLOSE_VIEWER_REJECT)
            return
        await websocket.accept()
        q = entry.broadcaster.subscribe()

        async def pump_out() -> None:
            try:
                while True:
                    msg = await asyncio.to_thread(q.get)
                    await websocket.send_json(broker_ws_payload_from_fanout(run_id, msg))
                    if msg.kind == "exit":
                        break
            finally:
                entry.broadcaster.unsubscribe(q)

        async def pump_in() -> None:
            while True:
                try:
                    message = await websocket.receive()
                except WebSocketDisconnect:
                    break
                except Exception as e:
                    _LOG.debug("ws pump_in receive: %s", e)
                    break
                if message["type"] == "websocket.disconnect":
                    break
                if message["type"] != "websocket.receive":
                    continue
                if "bytes" in message and message["bytes"] is not None:
                    continue
                raw = message.get("text")
                if raw is None:
                    continue
                try:
                    o = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if not isinstance(o, dict) or o.get("type") != "cancel_run":
                    continue
                msg_rid = o.get("runId")
                if msg_rid is None:
                    continue
                if str(msg_rid).strip() != run_id:
                    continue
                reg.cancel(run_id)

        out_task = asyncio.create_task(pump_out())
        in_task = asyncio.create_task(pump_in())
        try:
            await out_task
        finally:
            in_task.cancel()
            try:
                await in_task
            except asyncio.CancelledError:
                pass
            try:
                await websocket.close()
            except Exception as e:
                _LOG.debug("websocket.close after ws_run: %s", e)

    return ws_run
