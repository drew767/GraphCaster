# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
import os
from pathlib import Path

from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from graph_caster.artifacts import (
    list_persisted_run_entries,
    read_persisted_events_ndjson_capped,
    read_persisted_run_summary_text,
)
from graph_caster.run_broker.errors import PendingQueueFullError
from graph_caster.run_broker.idempotency import IdempotencyCache
from graph_caster.run_broker.registry import RunBrokerRegistry
from graph_caster.run_broker.routes.common import MAX_PERSISTED_EVENTS_BYTES
from graph_caster.run_broker.routes.responses import new_run_json, pending_queue_full_response
from graph_caster.run_broker.webhook_signature import verify_webhook_signature
from graph_caster.run_catalog import list_run_catalog_rows, rebuild_catalog_from_disk


def make_http_handlers(
    reg: RunBrokerRegistry,
    webhook_idempotency: IdempotencyCache,
) -> dict[str, object]:
    async def health(request: Request) -> Response:
        body: dict[str, object] = {"ok": True}
        if request.query_params.get("debug") == "1":
            body["broadcasters"] = reg.debug_broadcaster_metrics()
        return JSONResponse(body)

    async def prometheus_metrics(request: Request) -> Response:
        return Response(
            reg.prometheus_metrics_text(),
            media_type="text/plain; version=0.0.4; charset=utf-8",
        )

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
            return pending_queue_full_response()
        except ValueError as e:
            return JSONResponse({"error": str(e)}, status_code=400)
        entry = reg.get(sp.run_id)
        if entry is None:
            return JSONResponse({"error": "run lost after spawn"}, status_code=500)
        return JSONResponse(new_run_json(sp))

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
            cached = webhook_idempotency.get(key)
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
            return pending_queue_full_response()
        except ValueError as e:
            return JSONResponse({"error": str(e)}, status_code=400)
        entry = reg.get(sp.run_id)
        if entry is None:
            return JSONResponse({"error": "run lost after spawn"}, status_code=500)
        if idem_key is not None:
            webhook_idempotency.remember(
                idem_key,
                sp.run_id,
                sp.viewer_token,
                run_broker_phase=sp.phase,
                run_broker_queue_position=sp.queue_position,
            )
        return JSONResponse(new_run_json(sp))

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
        max_bytes = max(0, min(max_bytes, MAX_PERSISTED_EVENTS_BYTES))
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

    async def run_catalog_list(request: Request) -> Response:
        try:
            body = await request.json()
        except (json.JSONDecodeError, ValueError, TypeError):
            return JSONResponse({"error": "invalid JSON body"}, status_code=400)
        if not isinstance(body, dict):
            return JSONResponse({"error": "body must be object"}, status_code=400)
        ab = body.get("artifactsBase")
        if not ab or not str(ab).strip():
            return JSONResponse({"error": "artifactsBase required"}, status_code=400)
        raw_gid = body.get("graphId")
        raw_st = body.get("status")
        graph_id = str(raw_gid).strip() if raw_gid is not None and str(raw_gid).strip() else None
        status_f = str(raw_st).strip() if raw_st is not None and str(raw_st).strip() else None
        raw_lim = body.get("limit", 100)
        raw_off = body.get("offset", 0)
        try:
            limit = int(raw_lim) if raw_lim is not None else 100
            offset = int(raw_off) if raw_off is not None else 0
        except (TypeError, ValueError):
            return JSONResponse({"error": "limit and offset must be integers"}, status_code=400)
        rows = list_run_catalog_rows(
            Path(str(ab)),
            graph_id=graph_id,
            status=status_f,
            limit=limit,
            offset=offset,
        )
        return JSONResponse({"items": rows})

    async def run_catalog_rebuild(request: Request) -> Response:
        try:
            body = await request.json()
        except (json.JSONDecodeError, ValueError, TypeError):
            return JSONResponse({"error": "invalid JSON body"}, status_code=400)
        if not isinstance(body, dict):
            return JSONResponse({"error": "body must be object"}, status_code=400)
        ab = body.get("artifactsBase")
        if not ab or not str(ab).strip():
            return JSONResponse({"error": "artifactsBase required"}, status_code=400)
        try:
            n = rebuild_catalog_from_disk(Path(str(ab)))
        except ValueError as e:
            return JSONResponse({"error": str(e)}, status_code=400)
        return JSONResponse({"rebuilt": n})

    return {
        "health": health,
        "prometheus_metrics": prometheus_metrics,
        "create_run": create_run,
        "webhook_run": webhook_run,
        "cancel_run": cancel_run,
        "persisted_list": persisted_list,
        "persisted_events": persisted_events,
        "persisted_summary": persisted_summary,
        "run_catalog_list": run_catalog_list,
        "run_catalog_rebuild": run_catalog_rebuild,
    }
