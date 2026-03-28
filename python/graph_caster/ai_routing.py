# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any, Callable

from graph_caster.models import Edge, GraphDocument, Node

AI_ROUTE_MAX_ROUTE_DESCRIPTION_LEN = 1024

_SENSITIVE_KEY_RE = re.compile(
    r"(apikey|api_key|secret|token|password|auth|bearer)$",
    re.IGNORECASE,
)


def _truncate_str(s: str, max_bytes: int) -> str:
    raw = s.encode("utf-8")
    if len(raw) <= max_bytes:
        return s
    cut = max_bytes
    while cut > 0 and (raw[cut - 1] & 0xC0) == 0x80:
        cut -= 1
    return raw[:cut].decode("utf-8", errors="ignore") + "…"


def _redact_object(obj: Any, max_depth: int, max_bytes: int) -> Any:
    if max_depth < 0:
        return None
    if isinstance(obj, dict):
        out: dict[str, Any] = {}
        for k, v in obj.items():
            ks = str(k)
            lk = ks.lower().replace("-", "_")
            if _SENSITIVE_KEY_RE.search(lk) or "secret" in lk or "token" in lk:
                out[ks] = "[redacted]"
            else:
                out[ks] = _redact_object(v, max_depth - 1, max_bytes)
        return out
    if isinstance(obj, list):
        return [_redact_object(x, max_depth - 1, max_bytes) for x in obj[:200]]
    if isinstance(obj, str):
        return _truncate_str(obj, min(max_bytes, 8192))
    return obj


_AI_ROUTE_WIRE_SEPARATORS = (",", ":")


def encode_ai_route_wire_body(body: dict[str, Any]) -> bytes:
    return json.dumps(body, ensure_ascii=False, separators=_AI_ROUTE_WIRE_SEPARATORS).encode("utf-8")


def edge_route_description(edge: Edge) -> str:
    d = edge.data
    if not d:
        return ""
    rd = d.get("routeDescription")
    if rd is None:
        return ""
    s = str(rd).strip()
    if len(s) > AI_ROUTE_MAX_ROUTE_DESCRIPTION_LEN:
        return s[: AI_ROUTE_MAX_ROUTE_DESCRIPTION_LEN]
    return s


def ordered_ai_route_out_edges(doc: GraphDocument, node_id: str) -> list[Edge]:
    out: list[Edge] = []
    for e in doc.edges:
        if e.source != node_id:
            continue
        if e.source_handle == "out_error":
            continue
        out.append(e)
    return out


def usable_ai_route_out_edges(doc: GraphDocument, node_id: str) -> list[Edge]:
    by_id = {n.id: n for n in doc.nodes}
    out: list[Edge] = []
    for e in ordered_ai_route_out_edges(doc, node_id):
        t = by_id.get(e.target)
        if t is None or t.type == "comment":
            continue
        out.append(e)
    return out


def _last_node_output_for_ai(ctx: dict[str, Any], preds: list[str], max_bytes: int) -> Any:
    outs = ctx.get("node_outputs") or {}
    if len(preds) == 0:
        lr = ctx.get("last_result")
        return _redact_object(lr, max_depth=6, max_bytes=max_bytes)
    if len(preds) == 1:
        one = outs.get(preds[0])
        return _redact_object(one, max_depth=6, max_bytes=max_bytes)
    merged: dict[str, Any] = {}
    for pid in preds:
        merged[pid] = _redact_object(outs.get(pid), max_depth=5, max_bytes=max_bytes // max(len(preds), 1))
    return merged


def build_ai_route_request(
    *,
    doc: GraphDocument,
    node: Node,
    outgoing: list[Edge],
    ctx: dict[str, Any],
    run_id: str,
    max_request_bytes: int,
    preds: list[str],
) -> tuple[dict[str, Any] | None, str | None]:
    author = node.data.get("authorHint")
    ah = str(author).strip() if author is not None else ""
    items: list[dict[str, Any]] = []
    for i, e in enumerate(outgoing, start=1):
        desc = edge_route_description(e)
        if not desc:
            tid = e.target
            desc = f"to {tid}"
        items.append(
            {
                "index": i,
                "edgeId": e.id,
                "targetNodeId": e.target,
                "description": desc,
            }
        )
    last_out = _last_node_output_for_ai(ctx, preds, max_bytes=min(max_request_bytes // 4, 262144))
    body: dict[str, Any] = {
        "schemaVersion": 1,
        "graphId": doc.graph_id,
        "nodeId": node.id,
        "runId": run_id,
        "outgoing": items,
        "lastNodeOutput": last_out,
    }
    if ah:
        body["authorHint"] = ah
    n = len(encode_ai_route_wire_body(body))
    if n > max_request_bytes:
        return None, "request_too_large"
    return body, None


ProviderFn = Callable[[dict[str, Any]], dict[str, Any]]


def _parse_choice_index(resp: dict[str, Any]) -> int | None:
    v = resp.get("choiceIndex")
    if isinstance(v, bool):
        return None
    if isinstance(v, int):
        return int(v)
    if isinstance(v, float) and v == int(v):
        return int(v)
    if isinstance(v, str) and v.strip().lstrip("-").isdigit():
        try:
            return int(v.strip(), 10)
        except ValueError:
            return None
    return None


def http_json_provider(
    url: str,
    body: dict[str, Any],
    *,
    timeout_sec: float,
    bearer_token: str | None,
) -> dict[str, Any]:
    payload = encode_ai_route_wire_body(body)
    req = urllib.request.Request(
        url,
        data=payload,
        method="POST",
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    if bearer_token:
        req.add_header("Authorization", f"Bearer {bearer_token}")
    with urllib.request.urlopen(req, timeout=timeout_sec) as r:
        raw = r.read()
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise ValueError(f"invalid_response_json:{e}") from e
    if not isinstance(parsed, dict):
        raise ValueError("invalid_response_json:not_object")
    return parsed


@dataclass
class AiRouteOutcome:
    chosen: Edge | None
    error_reason: str | None
    error_detail: str | None


def resolve_ai_route_choice(
    *,
    doc: GraphDocument,
    node: Node,
    ctx: dict[str, Any],
    run_id: str,
    preds: list[str],
    provider_override: ProviderFn | None,
) -> AiRouteOutcome:
    d = node.data
    outgoing = usable_ai_route_out_edges(doc, node.id)
    n_out = len(outgoing)
    if n_out == 0:
        return AiRouteOutcome(None, "no_outgoing_edges", None)
    if n_out == 1:
        return AiRouteOutcome(outgoing[0], None, None)

    max_req = int(d.get("maxRequestJsonBytes") or 65536)
    if max_req < 256:
        max_req = 256

    body, err = build_ai_route_request(
        doc=doc,
        node=node,
        outgoing=outgoing,
        ctx=ctx,
        run_id=run_id,
        max_request_bytes=max_req,
        preds=preds,
    )
    if err:
        return AiRouteOutcome(None, err, None)
    assert body is not None

    url = str(d.get("endpointUrl") or "").strip()
    if not url and provider_override is None:
        return AiRouteOutcome(None, "empty_endpoint", None)

    timeout_sec = float(d.get("timeoutSec") if d.get("timeoutSec") is not None else 30.0)
    if timeout_sec < 0.1:
        timeout_sec = 0.1
    max_retries = int(d.get("maxRetries") or 0)
    if max_retries < 0:
        max_retries = 0
    backoff = float(d.get("retryBackoffSec") if d.get("retryBackoffSec") is not None else 1.0)
    if backoff < 0:
        backoff = 0.0

    env_key = str(d.get("envVarApiKey") or "").strip()
    token: str | None = None
    if env_key:
        token = os.environ.get(env_key)
        if token is None:
            token = ""
        else:
            token = str(token)

    last_net: str | None = None
    for attempt in range(max_retries + 1):
        try:
            if provider_override is not None:
                resp = provider_override(body)
            else:
                resp = http_json_provider(url, body, timeout_sec=timeout_sec, bearer_token=token or None)
        except urllib.error.HTTPError as e:
            last_net = f"http {e.code}"
            if attempt < max_retries:
                time.sleep(backoff)
                continue
            return AiRouteOutcome(None, "http_error", last_net)
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last_net = str(e)[:500]
            if attempt < max_retries:
                time.sleep(backoff)
                continue
            return AiRouteOutcome(None, "http_error", last_net)
        except ValueError as e:
            msg = str(e)
            if msg.startswith("invalid_response_json"):
                return AiRouteOutcome(None, "invalid_response_json", msg)
            return AiRouteOutcome(None, "provider_exception", msg[:500])
        except Exception as e:
            return AiRouteOutcome(None, "provider_exception", str(e)[:500])
        else:
            idx = _parse_choice_index(resp)
            if idx is None:
                return AiRouteOutcome(None, "invalid_response_json", "missing_or_bad_choiceIndex")
            if idx < 1 or idx > n_out:
                return AiRouteOutcome(None, "choice_index_out_of_range", f"{idx} not in 1..{n_out}")
            return AiRouteOutcome(outgoing[idx - 1], None, None)

    return AiRouteOutcome(None, "http_error", last_net or "exhausted_retries")
