# Copyright GraphCaster. All Rights Reserved.

"""In-process HTTP client for ``http_request`` nodes (stdlib only)."""

from __future__ import annotations

import base64
import json
import ssl
import urllib.error
import urllib.request
from typing import Any, Callable
from urllib.parse import urlparse

from graph_caster.expression.templates import render_template
from graph_caster.runner.expression_conditions import runner_predicate_to_expression_context

EmitFn = Callable[..., None]

_MAX_RESPONSE_BODY = 4 * 1024 * 1024
_DEFAULT_TIMEOUT = 30.0


def _template_context(ctx: dict[str, Any]) -> dict[str, Any]:
    return dict(runner_predicate_to_expression_context(ctx))


def redact_http_request_data_for_execute(data: dict[str, Any]) -> dict[str, Any]:
    """Strip secrets for ``node_execute`` events."""
    out = dict(data)
    auth = out.get("auth")
    if isinstance(auth, dict):
        a = dict(auth)
        t = str(a.get("type") or "").lower()
        if t == "basic":
            if a.get("password") is not None:
                a["password"] = "<redacted>"
        elif t == "bearer":
            if a.get("token") is not None:
                a["token"] = "<redacted>"
        out["auth"] = a
    return out


def _bool_data(data: dict[str, Any], key: str, default: bool) -> bool:
    v = data.get(key, default)
    if v is True or v is False:
        return v
    if isinstance(v, str):
        return v.strip().lower() in ("1", "true", "yes", "y")
    return default


def _float_data(data: dict[str, Any], key: str, default: float) -> float:
    v = data.get(key, default)
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def execute_http_request(
    *,
    node_id: str,
    graph_id: str,
    data: dict[str, Any],
    ctx: dict[str, Any],
    emit: EmitFn,
    attempt: int = 0,
    should_cancel: Callable[[], bool] | None = None,
    template_context_extra: dict[str, Any] | None = None,
) -> tuple[bool, dict[str, Any]]:
    """
    Perform one HTTP round-trip. Emits ``process_complete`` (``exitCode`` = HTTP status or 0 on transport error).

    Returns ``(success, patch)`` where ``patch`` entries merge into ``node_outputs[node_id]``:
    ``processResult``, ``httpResult``.
    """
    tmpl_ctx = _template_context(ctx)
    if template_context_extra:
        tmpl_ctx = {**tmpl_ctx, **template_context_extra}
    raw_url = data.get("url")
    if not isinstance(raw_url, str) or not raw_url.strip():
        emit(
            "process_complete",
            nodeId=node_id,
            graphId=graph_id,
            exitCode=0,
            timedOut=False,
            attempt=attempt,
            success=False,
            stdoutTail="",
            stderrTail="missing_url",
        )
        err = "http_request_missing_url"
        return False, {
            "processResult": {"success": False, "exitCode": 0, "timedOut": False, "error": err},
            "httpResult": {
                "success": False,
                "statusCode": 0,
                "error": err,
                "bodyText": "",
                "bodyJson": None,
            },
        }

    url = render_template(raw_url.strip(), tmpl_ctx)
    method = str(data.get("method") or "GET").strip().upper() or "GET"
    if method not in (
        "GET",
        "HEAD",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "OPTIONS",
    ):
        method = "GET"

    headers: dict[str, str] = {}
    hdr_in = data.get("headers")
    if isinstance(hdr_in, dict):
        for k, v in hdr_in.items():
            if not isinstance(k, str) or not k.strip():
                continue
            if v is None:
                continue
            headers[k.strip()] = render_template(str(v), tmpl_ctx)

    auth = data.get("auth")
    if isinstance(auth, dict):
        at = str(auth.get("type") or "").strip().lower()
        if at == "basic":
            u = render_template(str(auth.get("username") or ""), tmpl_ctx)
            p = render_template(str(auth.get("password") or ""), tmpl_ctx)
            token = base64.b64encode(f"{u}:{p}".encode("utf-8")).decode("ascii")
            headers["Authorization"] = f"Basic {token}"
        elif at == "bearer":
            tok = render_template(str(auth.get("token") or ""), tmpl_ctx)
            headers["Authorization"] = f"Bearer {tok}"

    body_str: str | None = None
    if method in ("POST", "PUT", "PATCH"):
        raw_body = data.get("body")
        if raw_body is not None:
            if data.get("bodyLiteral") is True:
                body_str = str(raw_body)
            else:
                body_str = render_template(str(raw_body), tmpl_ctx)

    timeout = max(0.5, _float_data(data, "timeoutSec", _DEFAULT_TIMEOUT))
    verify_tls = _bool_data(data, "verifyTls", True)

    parse = str(data.get("parseResponseBody") or "auto").strip().lower()
    if parse not in ("auto", "json", "text"):
        parse = "auto"

    host = urlparse(url).hostname or ""
    context = ssl.create_default_context()
    if not verify_tls and host:
        context.check_hostname = False
        context.verify_mode = ssl.CERT_NONE

    req_data: bytes | None = None
    if body_str is not None:
        req_data = body_str.encode("utf-8")
        headers.setdefault("Content-Type", headers.get("Content-Type", "application/json"))

    req = urllib.request.Request(url, data=req_data, headers=headers, method=method)

    if should_cancel is not None and should_cancel():
        emit(
            "process_complete",
            nodeId=node_id,
            graphId=graph_id,
            exitCode=0,
            timedOut=False,
            attempt=attempt,
            success=False,
            cancelled=True,
            stdoutTail="",
            stderrTail="cancelled_before_request",
        )
        return False, {
            "processResult": {
                "success": False,
                "exitCode": 0,
                "timedOut": False,
                "cancelled": True,
                "error": "cancelled_before_request",
            },
            "httpResult": {
                "success": False,
                "statusCode": 0,
                "error": "cancelled_before_request",
                "bodyText": "",
                "bodyJson": None,
            },
        }

    status = 0
    resp_headers: dict[str, str] = {}
    body_text = ""
    body_json: Any | None = None
    err_msg: str | None = None

    try:
        with urllib.request.urlopen(req, timeout=timeout, context=context) as resp:  # noqa: S310
            status = int(getattr(resp, "status", 0) or 0)
            if hasattr(resp, "headers"):
                for hk, hv in resp.headers.items():
                    resp_headers[str(hk)] = str(hv)
            raw = resp.read(_MAX_RESPONSE_BODY + 1)
            if len(raw) > _MAX_RESPONSE_BODY:
                err_msg = "response_body_too_large"
                body_text = ""
            else:
                body_text = raw.decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        status = int(e.code)
        if e.headers:
            for hk, hv in e.headers.items():
                resp_headers[str(hk)] = str(hv)
        try:
            raw = e.read(_MAX_RESPONSE_BODY + 1)
            body_text = raw.decode("utf-8", errors="replace") if len(raw) <= _MAX_RESPONSE_BODY else ""
            if len(raw) > _MAX_RESPONSE_BODY:
                err_msg = "response_body_too_large"
        except Exception:
            body_text = ""
    except urllib.error.URLError as e:
        err_msg = str(e.reason) if getattr(e, "reason", None) else str(e)
        status = 0
    except TimeoutError:
        err_msg = "timeout"
        status = 0
    except Exception as e:
        err_msg = str(e)
        status = 0

    if err_msg is None and status == 0:
        err_msg = "request_failed"

    ct = (resp_headers.get("Content-Type") or "").lower()
    want_json = parse == "json" or (
        parse == "auto" and ("application/json" in ct or body_text.strip().startswith("{"))
    )
    if want_json and body_text.strip():
        try:
            body_json = json.loads(body_text)
        except json.JSONDecodeError:
            body_json = None

    ok_http = err_msg is None and 200 <= status < 300
    emit(
        "process_complete",
        nodeId=node_id,
        graphId=graph_id,
        exitCode=status,
        timedOut=False,
        attempt=attempt,
        success=ok_http,
        stdoutTail=body_text[:4000] if body_text else "",
        stderrTail=err_msg or "",
    )

    last_res: dict[str, Any] = {
        "statusCode": status,
        "ok": ok_http,
    }
    if body_json is not None:
        last_res["json"] = body_json
    elif body_text:
        last_res["body"] = body_text

    patch: dict[str, Any] = {
        "processResult": {
            "success": ok_http,
            "exitCode": status,
            "timedOut": False,
            "error": None if ok_http else (err_msg or f"HTTP_{status}"),
        },
        "httpResult": {
            "success": ok_http,
            "statusCode": status,
            "headers": resp_headers,
            "bodyText": body_text,
            "bodyJson": body_json,
            "error": err_msg,
        },
    }
    ctx["last_result"] = last_res
    return ok_http, patch
