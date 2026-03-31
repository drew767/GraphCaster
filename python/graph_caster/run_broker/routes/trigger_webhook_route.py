# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import base64
import json
import os
from pathlib import Path
from typing import Any

from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from graph_caster.models import GraphDocument, Node
from graph_caster.nodes.trigger_webhook import webhook_node_config_from_data
from graph_caster.run_broker.errors import PendingQueueFullError
from graph_caster.run_broker.registry import RunBrokerRegistry
from graph_caster.run_broker.registry_run_manager import BrokerRegistryRunManager
from graph_caster.run_broker.routes.responses import (
    graph_webhook_wait_json,
    new_run_json,
    pending_queue_full_response,
)
from graph_caster.workspace import resolve_graph_path


def _norm_suffix(path: str) -> str:
    return str(path or "").strip().lstrip("/")


def _trigger_webhook_auth_ok(data: dict[str, Any], request: Request) -> bool:
    auth = str(data.get("auth", "none") or "none").strip().lower()
    secret_raw = data.get("secret")
    sec = str(secret_raw).strip() if secret_raw is not None else ""
    if auth in ("none", ""):
        return True
    if auth == "bearer":
        h = (request.headers.get("authorization") or "").strip()
        if not h.lower().startswith("bearer "):
            return False
        return h[7:].strip() == sec
    if auth == "api_key":
        return (request.headers.get("x-api-key") or "").strip() == sec
    if auth == "basic":
        h = (request.headers.get("authorization") or "").strip()
        if not h.lower().startswith("basic "):
            return False
        try:
            decoded = base64.b64decode(h[6:].strip()).decode("utf-8")
        except (OSError, ValueError, UnicodeDecodeError):
            return False
        return decoded == sec
    return False


def _find_matching_webhook_nodes(
    doc: GraphDocument, *, url_suffix: str, method: str
) -> list[Node]:
    m = method.upper()
    out: list[Node] = []
    for n in doc.nodes:
        if n.type != "trigger_webhook":
            continue
        d = n.data or {}
        p = str(d.get("path", "")).strip()
        if _norm_suffix(p) != url_suffix:
            continue
        m_raw = d.get("method", "POST")
        nm = str(m_raw).strip().upper() if m_raw is not None else "POST"
        if not nm:
            nm = "POST"
        if nm != m:
            continue
        out.append(n)
    return out


def _webhook_wait_timeout_sec(data: dict[str, Any]) -> float:
    raw = data.get("wait_timeout_sec", data.get("waitTimeoutSec", 300))
    try:
        t = float(raw)
    except (TypeError, ValueError):
        t = 300.0
    return max(1.0, min(t, 3600.0))


async def handle_webhook_graph_trigger(request: Request, reg: RunBrokerRegistry) -> Response:
    raw_dir = os.environ.get("GC_RUN_BROKER_GRAPHS_DIR", "").strip()
    if not raw_dir:
        return JSONResponse({"error": "graphs_dir_not_configured"}, status_code=503)
    graphs_dir = Path(raw_dir)
    if not graphs_dir.is_dir():
        return JSONResponse({"error": "graphs_dir_not_configured"}, status_code=503)

    graph_id = str(request.path_params.get("graph_id") or "").strip()
    if not graph_id:
        return JSONResponse({"error": "graph_id required"}, status_code=400)

    sub = request.path_params.get("path")
    url_suffix = _norm_suffix(str(sub) if sub is not None else "")

    path = resolve_graph_path(graphs_dir, graph_id)
    if path is None or not path.is_file():
        return JSONResponse({"error": "unknown_graph"}, status_code=404)

    try:
        doc_raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return JSONResponse({"error": "invalid_graph_file"}, status_code=500)

    try:
        doc = GraphDocument.from_dict(doc_raw)
    except ValueError as e:
        return JSONResponse({"error": f"invalid graph document: {e}"}, status_code=500)

    matches = _find_matching_webhook_nodes(doc, url_suffix=url_suffix, method=request.method)
    if not matches:
        return JSONResponse({"error": "no_matching_trigger_webhook"}, status_code=404)
    if len(matches) > 1:
        return JSONResponse(
            {"error": "ambiguous_trigger_webhook", "nodeIds": [n.id for n in matches]},
            status_code=409,
        )
    node = matches[0]
    data = node.data or {}
    if not _trigger_webhook_auth_ok(data, request):
        return JSONResponse({"error": "unauthorized"}, status_code=401)

    payload: Any = {}
    if request.method in ("POST", "PUT", "PATCH"):
        body = await request.body()
        if body:
            ct = (request.headers.get("content-type") or "").lower()
            if "application/json" in ct:
                try:
                    payload = json.loads(body.decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError, ValueError, TypeError):
                    return JSONResponse({"error": "invalid JSON body"}, status_code=400)
            else:
                payload = {"bodyText": body.decode("utf-8", errors="replace")}

    if not isinstance(payload, dict):
        payload = {"_body": payload}

    hdrs = {k: v for k, v in request.headers.items()}
    trigger: dict[str, Any] = {
        "type": "webhook",
        "payload": payload,
        "headers": hdrs,
        "method": request.method,
        "query": dict(request.query_params),
    }

    merged_context: dict[str, Any] = {"trigger": trigger}
    doc_json_str = json.dumps(doc_raw, ensure_ascii=False)

    workspace_raw = os.environ.get("GC_RUN_BROKER_WORKSPACE_ROOT", "").strip()
    artifacts_raw = os.environ.get("GC_RUN_BROKER_ARTIFACTS_BASE", "").strip()

    body_out: dict[str, Any] = {
        "documentJson": doc_json_str,
        "startNodeId": node.id,
        "graphsDir": str(graphs_dir.resolve()),
        "contextJson": merged_context,
    }
    if workspace_raw:
        body_out["workspaceRoot"] = workspace_raw
    if artifacts_raw:
        body_out["artifactsBase"] = artifacts_raw

    try:
        sp = reg.spawn_from_body(body_out)
    except PendingQueueFullError:
        return pending_queue_full_response()
    except ValueError as e:
        return JSONResponse({"error": str(e)}, status_code=400)
    entry = reg.get(sp.run_id)
    if entry is None:
        return JSONResponse({"error": "run lost after spawn"}, status_code=500)

    reg.bind_run_graph_id(sp.run_id, graph_id)

    wh_cfg = webhook_node_config_from_data(data)
    if str(wh_cfg.get("response_mode", "immediate")) == "wait":
        mgr = BrokerRegistryRunManager.from_env(reg)
        timeout = _webhook_wait_timeout_sec(data)
        wait_out = await mgr.wait_for_run(sp.run_id, timeout=timeout)
        return JSONResponse(graph_webhook_wait_json(sp, wait_out))

    return JSONResponse(new_run_json(sp))
