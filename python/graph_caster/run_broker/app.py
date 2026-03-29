# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import asyncio
import json
import logging
import os
import secrets
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

from starlette.applications import Starlette
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response, StreamingResponse
from starlette.routing import Route, WebSocketRoute
from starlette.websockets import WebSocket, WebSocketDisconnect

from graph_caster.artifacts import (
    list_persisted_run_entries,
    read_persisted_events_ndjson_capped,
    read_persisted_run_summary_text,
)
from graph_caster.run_broker.errors import PendingQueueFullError
from graph_caster.run_broker.idempotency import IdempotencyCache
from graph_caster.run_broker.registry import RunBrokerRegistry, SpawnResult
from graph_caster.run_broker.webhook_signature import verify_webhook_signature
from graph_caster.run_transport.ws_envelope import broker_ws_payload_from_fanout

_GLOBAL_REGISTRY = RunBrokerRegistry()
_WEBHOOK_IDEMPOTENCY = IdempotencyCache()
_LOG = logging.getLogger(__name__)

_WS_CLOSE_DEV_TOKEN = 1008
_WS_CLOSE_VIEWER_REJECT = 4401
_WS_CLOSE_UNKNOWN_RUN = 4404


def _const_time_str_eq(left: str, right: str) -> bool:
    return secrets.compare_digest(left.encode("utf-8"), right.encode("utf-8"))

_MAX_PERSISTED_EVENTS_BYTES = 16 * 1024 * 1024


def _new_run_json(sp: SpawnResult) -> dict:
    return {
        "runId": sp.run_id,
        "viewerToken": sp.viewer_token,
        "runBroker": {"phase": sp.phase, "queuePosition": sp.queue_position},
    }


def _pending_queue_full_response() -> JSONResponse:
    return JSONResponse(
        {"error": "pending_queue_full", "message": PendingQueueFullError.default_message},
        status_code=503,
    )


def _broker_token_ok(request: Request, secret: str) -> bool:
    h = request.headers.get("x-gc-dev-token") or ""
    if h and _const_time_str_eq(h, secret):
        return True
    q = request.query_params.get("token") or ""
    if q and _const_time_str_eq(q, secret):
        return True
    return False


def _broker_ws_token_ok(websocket: WebSocket, secret: str) -> bool:
    h = websocket.headers.get("x-gc-dev-token") or ""
    if h and _const_time_str_eq(h, secret):
        return True
    q = websocket.query_params.get("token") or ""
    if q and _const_time_str_eq(q, secret):
        return True
    return False


class BrokerTokenMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        if request.url.path == "/webhooks/run":
            return await call_next(request)
        token = os.environ.get("GC_RUN_BROKER_TOKEN", "").strip()
        if token and not _broker_token_ok(request, token):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        return await call_next(request)


def create_app(registry: RunBrokerRegistry | None = None) -> Starlette:
    reg = registry if registry is not None else _GLOBAL_REGISTRY

    async def health(_: Request) -> Response:
        return JSONResponse({"ok": True})

    async def create_run(request: Request) -> Response:
        try:
            body = await request.json()
        except (json.JSONDecodeError, ValueError, TypeError):
            return JSONResponse({"error": "invalid JSON body"}, status_code=400)
        if not isinstance(body, dict):
            return JSONResponse({"error": "body must be object"}, status_code=400)
        try:
            sp = reg.spawn_from_body(body)
        except PendingQueueFullError:
            return _pending_queue_full_response()
        except ValueError as e:
            return JSONResponse({"error": str(e)}, status_code=400)
        entry = reg.get(sp.run_id)
        if entry is None:
            return JSONResponse({"error": "run lost after spawn"}, status_code=500)
        return JSONResponse(_new_run_json(sp))

    async def webhook_run(request: Request) -> Response:
        wh_secret = os.environ.get("GC_RUN_BROKER_WEBHOOK_SECRET", "").strip()
        if not wh_secret:
            return JSONResponse({"error": "webhook_not_configured"}, status_code=404)
        raw = await request.body()
        sig = request.headers.get("X-GC-Webhook-Signature") or request.headers.get(
            "x-gc-webhook-signature"
        )
        if not verify_webhook_signature(raw, sig, wh_secret):
            return JSONResponse({"error": "invalid_signature"}, status_code=401)

        idem_header = request.headers.get("X-GC-Idempotency-Key") or request.headers.get(
            "x-gc-idempotency-key"
        )
        idem_key: str | None = None
        if idem_header is not None:
            key = idem_header.strip()
            if not key or len(key) > 256:
                return JSONResponse({"error": "invalid_idempotency_key"}, status_code=400)
            idem_key = key
            cached = _WEBHOOK_IDEMPOTENCY.get(key)
            if cached is not None:
                rid_c, vt_c, phase_c, pos_c = cached
                return JSONResponse(
                    {
                        "runId": rid_c,
                        "viewerToken": vt_c,
                        "runBroker": {"phase": phase_c, "queuePosition": pos_c},
                    }
                )

        try:
            parsed = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError, TypeError):
            return JSONResponse({"error": "invalid JSON body"}, status_code=400)
        if not isinstance(parsed, dict):
            return JSONResponse({"error": "body must be object"}, status_code=400)
        try:
            sp = reg.spawn_from_body(parsed)
        except PendingQueueFullError:
            return _pending_queue_full_response()
        except ValueError as e:
            return JSONResponse({"error": str(e)}, status_code=400)
        entry = reg.get(sp.run_id)
        if entry is None:
            return JSONResponse({"error": "run lost after spawn"}, status_code=500)
        if idem_key is not None:
            _WEBHOOK_IDEMPOTENCY.remember(
                idem_key,
                sp.run_id,
                sp.viewer_token,
                run_broker_phase=sp.phase,
                run_broker_queue_position=sp.queue_position,
            )
        return JSONResponse(_new_run_json(sp))

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

    async def cancel_run(request: Request) -> Response:
        run_id = request.path_params["run_id"]
        if not reg.cancel(run_id):
            return JSONResponse({"error": "cancel failed"}, status_code=404)
        return JSONResponse({"ok": True})

    async def persisted_list(request: Request) -> Response:
        try:
            body = await request.json()
        except (json.JSONDecodeError, ValueError, TypeError):
            return JSONResponse({"error": "invalid JSON body"}, status_code=400)
        if not isinstance(body, dict):
            return JSONResponse({"error": "body must be object"}, status_code=400)
        ab = body.get("artifactsBase")
        gid = body.get("graphId")
        if not ab or not str(ab).strip():
            return JSONResponse({"error": "artifactsBase required"}, status_code=400)
        if not gid or not str(gid).strip():
            return JSONResponse({"error": "graphId required"}, status_code=400)
        try:
            items = list_persisted_run_entries(Path(str(ab)), str(gid))
        except ValueError as e:
            return JSONResponse({"error": str(e)}, status_code=400)
        return JSONResponse({"items": items})

    async def persisted_events(request: Request) -> Response:
        try:
            body = await request.json()
        except (json.JSONDecodeError, ValueError, TypeError):
            return JSONResponse({"error": "invalid JSON body"}, status_code=400)
        if not isinstance(body, dict):
            return JSONResponse({"error": "body must be object"}, status_code=400)
        ab = body.get("artifactsBase")
        gid = body.get("graphId")
        rdn = body.get("runDirName")
        if not ab or not str(ab).strip():
            return JSONResponse({"error": "artifactsBase required"}, status_code=400)
        if not gid or not str(gid).strip():
            return JSONResponse({"error": "graphId required"}, status_code=400)
        if rdn is None or not str(rdn).strip():
            return JSONResponse({"error": "runDirName required"}, status_code=400)
        raw_mx = body.get("maxBytes")
        max_bytes = 1_000_000
        if raw_mx is not None:
            try:
                max_bytes = int(raw_mx)
            except (TypeError, ValueError):
                return JSONResponse({"error": "maxBytes must be int"}, status_code=400)
        max_bytes = max(0, min(max_bytes, _MAX_PERSISTED_EVENTS_BYTES))
        try:
            text, truncated = read_persisted_events_ndjson_capped(
                Path(str(ab)),
                str(gid),
                str(rdn),
                max_bytes,
            )
        except ValueError as e:
            return JSONResponse({"error": str(e)}, status_code=400)
        return JSONResponse({"text": text, "truncated": truncated})

    async def persisted_summary(request: Request) -> Response:
        try:
            body = await request.json()
        except (json.JSONDecodeError, ValueError, TypeError):
            return JSONResponse({"error": "invalid JSON body"}, status_code=400)
        if not isinstance(body, dict):
            return JSONResponse({"error": "body must be object"}, status_code=400)
        ab = body.get("artifactsBase")
        gid = body.get("graphId")
        rdn = body.get("runDirName")
        if not ab or not str(ab).strip():
            return JSONResponse({"error": "artifactsBase required"}, status_code=400)
        if not gid or not str(gid).strip():
            return JSONResponse({"error": "graphId required"}, status_code=400)
        if rdn is None or not str(rdn).strip():
            return JSONResponse({"error": "runDirName required"}, status_code=400)
        try:
            t = read_persisted_run_summary_text(Path(str(ab)), str(gid), str(rdn))
        except ValueError as e:
            return JSONResponse({"error": str(e)}, status_code=400)
        return JSONResponse({"text": t})

    async def ws_run(websocket: WebSocket) -> None:
        secret = os.environ.get("GC_RUN_BROKER_TOKEN", "").strip()
        if secret and not _broker_ws_token_ok(websocket, secret):
            await websocket.close(code=_WS_CLOSE_DEV_TOKEN)
            return
        run_id = websocket.path_params["run_id"]
        entry = reg.get(run_id)
        vt = (
            websocket.query_params.get("viewerToken") or websocket.query_params.get("pushRef") or ""
        ).strip()
        if entry is None:
            await websocket.close(code=_WS_CLOSE_UNKNOWN_RUN)
            return
        if not _const_time_str_eq(vt, entry.viewer_token):
            await websocket.close(code=_WS_CLOSE_VIEWER_REJECT)
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

    routes = [
        Route("/health", health, methods=["GET"]),
        Route("/webhooks/run", webhook_run, methods=["POST"]),
        Route("/runs", create_run, methods=["POST"]),
        Route("/runs/{run_id}/stream", stream_run, methods=["GET"]),
        WebSocketRoute("/runs/{run_id}/ws", ws_run),
        Route("/runs/{run_id}/cancel", cancel_run, methods=["POST"]),
        Route("/persisted-runs/list", persisted_list, methods=["POST"]),
        Route("/persisted-runs/events", persisted_events, methods=["POST"]),
        Route("/persisted-runs/summary", persisted_summary, methods=["POST"]),
    ]
    app = Starlette(routes=routes)
    if os.environ.get("GC_RUN_BROKER_TOKEN", "").strip():
        app.add_middleware(BrokerTokenMiddleware)
    return app
