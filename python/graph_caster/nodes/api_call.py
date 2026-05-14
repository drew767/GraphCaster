# Copyright GraphCaster. All Rights Reserved.

"""api_call node: dynamic HTTP client using httpx with retry, secrets masking, and expression expansion."""

from __future__ import annotations

import ipaddress
import json
import logging
import os
import socket
import time
from typing import Any, Callable
from urllib.parse import urlencode, urlparse, urlunparse, urljoin, parse_qs, urlencode

logger = logging.getLogger(__name__)

EmitFn = Callable[..., None]

_DEFAULT_TIMEOUT_SEC = 30.0
_MAX_RETRIES = 5
_REDACTED = "[redacted]"


def _build_expression_context(ctx: dict[str, Any]) -> dict[str, Any]:
    from graph_caster.runner.expression_conditions import runner_predicate_to_expression_context

    return dict(runner_predicate_to_expression_context(ctx))


def _render_str(value: str, expr_ctx: dict[str, Any]) -> str:
    """Render a string that may contain ``{{ expr }}`` placeholders."""
    from graph_caster.expression.templates import render_template

    return render_template(value, expr_ctx, error_placeholder="")


def _expand_value_with_secrets_first(
    value: str, workspace_secrets: dict[str, str], expr_ctx: dict[str, Any]
) -> tuple[str, bool]:
    """Expand ``{{ secret.NAME }}`` before regular expression placeholders.

    Returns ``(final_value, had_secret)``. Secret tokens are replaced with
    the resolved value so the expression evaluator never sees them.
    """
    had_secret = False

    def _replace_secret(m: _re.Match[str]) -> str:
        nonlocal had_secret
        had_secret = True
        return workspace_secrets.get(m.group(1), "")

    after_secrets = _SECRET_RE.sub(_replace_secret, value)
    final = _render_str(after_secrets, expr_ctx)
    return final, had_secret


def _expand_dict_values(d: dict[str, Any], expr_ctx: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in d.items():
        if isinstance(v, str):
            out[k] = _render_str(v, expr_ctx)
        else:
            out[k] = v
    return out


def _resolve_secret(key: str, workspace_secrets: dict[str, str]) -> str | None:
    return workspace_secrets.get(key)


_SECRET_PATTERN_STR = r"\{\{\s*secret\.(\w+)\s*\}\}"
import re as _re

_SECRET_RE = _re.compile(_SECRET_PATTERN_STR)


def _expand_with_secrets(value: str, workspace_secrets: dict[str, str]) -> tuple[str, bool]:
    """Expand ``{{ secret.NAME }}`` in *value*. Returns (expanded, had_secret)."""
    had_secret = False

    def _replace(m: _re.Match[str]) -> str:
        nonlocal had_secret
        had_secret = True
        secret_val = workspace_secrets.get(m.group(1), "")
        return secret_val

    return _SECRET_RE.sub(_replace, value), had_secret


def _redact_secrets_in_str(value: str) -> str:
    return _SECRET_RE.sub(_REDACTED, value)


def _redact_dict_for_event(d: dict[str, Any], workspace_secrets: dict[str, str]) -> dict[str, Any]:
    """Return a copy of *d* with secret values replaced by [redacted]."""
    secret_vals = set(v for v in workspace_secrets.values() if v)
    out: dict[str, Any] = {}
    for k, v in d.items():
        if isinstance(v, str):
            v2 = _redact_secrets_in_str(v)
            for sv in secret_vals:
                if sv and sv in v2:
                    v2 = v2.replace(sv, _REDACTED)
            out[k] = v2
        else:
            out[k] = v
    return out


def _allow_private_networks() -> bool:
    v = os.environ.get("GC_API_CALL_ALLOW_PRIVATE_NETWORKS", "").strip()
    return v == "1"


def _resolve_host_ips(host: str) -> list[ipaddress._BaseAddress]:
    """Resolve *host* to all IP addresses via ``socket.getaddrinfo``.

    Returns a list of ``ip_address`` objects. Raises ``ValueError`` with an
    SSRF-prefixed message if resolution fails.
    """
    if not host:
        raise ValueError("SSRF: missing hostname")
    try:
        infos = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise ValueError(f"SSRF: cannot resolve hostname: {host}") from exc
    seen: set[str] = set()
    out: list[ipaddress._BaseAddress] = []
    for info in infos:
        sockaddr = info[4]
        ip_str = sockaddr[0]
        if "%" in ip_str:
            ip_str = ip_str.split("%", 1)[0]
        if ip_str in seen:
            continue
        seen.add(ip_str)
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            continue
        out.append(ip)
    if not out:
        raise ValueError(f"SSRF: cannot resolve hostname: {host}")
    return out


def _is_disallowed_ip(ip: ipaddress._BaseAddress) -> bool:
    """Return True if *ip* falls in any range that must be blocked by default."""
    if ip.is_loopback or ip.is_link_local or ip.is_private or ip.is_reserved or ip.is_unspecified or ip.is_multicast:
        return True
    if isinstance(ip, ipaddress.IPv4Address):
        # CGNAT 100.64.0.0/10 — not marked private in stdlib but routable-internal.
        if ipaddress.IPv4Address("100.64.0.0") <= ip <= ipaddress.IPv4Address("100.127.255.255"):
            return True
    if isinstance(ip, ipaddress.IPv6Address):
        # IPv4-mapped IPv6 — unwrap and recheck.
        if ip.ipv4_mapped is not None:
            return _is_disallowed_ip(ip.ipv4_mapped)
        # Unique local addresses fc00::/7 — covered by is_private.
    return False


def _is_loopback_ip(ip: ipaddress._BaseAddress) -> bool:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        return _is_loopback_ip(ip.ipv4_mapped)
    return bool(ip.is_loopback)


def _validate_outbound_url(url: str) -> list[ipaddress._BaseAddress]:
    """Resolve and validate *url* against the SSRF blocklist.

    Returns the resolved IPs (for callers that need re-validation on redirect).
    Raises ``ValueError`` with an ``SSRF:`` prefix on rejection. Returns an
    empty list when private networks are explicitly allowed via env.
    """
    parsed = urlparse(url)
    scheme = (parsed.scheme or "").lower()
    if scheme not in ("http", "https"):
        raise ValueError(f"SSRF: scheme not allowed: {scheme!r}")
    host = parsed.hostname or ""
    if not host:
        raise ValueError("SSRF: missing hostname")

    if _allow_private_networks():
        # Still resolve so DNS errors surface, but skip blocklist enforcement.
        try:
            return _resolve_host_ips(host)
        except ValueError:
            return []

    ips = _resolve_host_ips(host)
    bad = [str(ip) for ip in ips if _is_disallowed_ip(ip)]
    if bad:
        raise ValueError(
            f"SSRF: host {host!r} resolves to disallowed address(es): {', '.join(bad)}"
        )
    return ips


def _is_localhost(url: str) -> bool:
    """Return True when *url*'s hostname resolves only to loopback addresses.

    Hardened against DNS-rebind tricks like ``127.0.0.1.attacker.com`` by
    verifying every resolved IP, not the literal hostname.
    """
    try:
        host = urlparse(url).hostname or ""
        if not host:
            return False
        ips = _resolve_host_ips(host)
    except Exception:
        return False
    if not ips:
        return False
    return all(_is_loopback_ip(ip) for ip in ips)


def _allow_insecure_localhost() -> bool:
    v = os.environ.get("GC_API_CALL_ALLOW_INSECURE_LOCALHOST", "").strip()
    return v == "1"


def _parse_response_body(
    response_bytes: bytes,
    response_as: str,
    content_type: str,
) -> Any:
    if response_as == "bytes":
        return response_bytes
    if response_as == "text":
        try:
            return response_bytes.decode("utf-8", errors="replace")
        except Exception:
            return response_bytes.decode("latin-1", errors="replace")
    if response_as == "json":
        try:
            return json.loads(response_bytes)
        except json.JSONDecodeError:
            try:
                return response_bytes.decode("utf-8", errors="replace")
            except Exception:
                return None
    ct_lower = content_type.lower()
    if "application/json" in ct_lower or ct_lower.endswith("+json"):
        try:
            return json.loads(response_bytes)
        except json.JSONDecodeError:
            pass
    try:
        return response_bytes.decode("utf-8", errors="replace")
    except Exception:
        return None


def _build_query_string(url: str, query: dict[str, Any]) -> str:
    if not query:
        return url
    parsed = urlparse(url)
    existing = parsed.query
    new_params = urlencode({str(k): str(v) for k, v in query.items()})
    combined = f"{existing}&{new_params}" if existing else new_params
    return urlunparse(parsed._replace(query=combined))


def execute_api_call(
    *,
    node_id: str,
    graph_id: str,
    data: dict[str, Any],
    ctx: dict[str, Any],
    emit: EmitFn,
    attempt: int = 0,
    workspace_secrets: dict[str, str] | None = None,
    transport: Any | None = None,
) -> tuple[bool, dict[str, Any]]:
    """Execute one api_call round-trip.

    Returns ``(success, patch)`` where patch merges into ``node_outputs[node_id]``:
    ``processResult``, ``apiCallResult``.
    """
    import httpx

    ws = workspace_secrets or {}
    expr_ctx = _build_expression_context(ctx)

    method = str(data.get("method") or "GET").upper()
    if method not in ("GET", "POST", "PUT", "PATCH", "DELETE"):
        method = "GET"

    raw_url = str(data.get("url") or "")
    if not raw_url:
        emit(
            "process_complete",
            nodeId=node_id,
            graphId=graph_id,
            exitCode=1,
            timedOut=False,
            success=False,
            error="missing_url",
        )
        return False, {
            "processResult": {"success": False, "exitCode": 1, "timedOut": False, "error": "missing_url"},
            "apiCallResult": {"success": False, "error": "missing_url"},
        }

    url_expanded, _ = _expand_value_with_secrets_first(raw_url, ws, expr_ctx)

    raw_headers: dict[str, Any] = data.get("headers") if isinstance(data.get("headers"), dict) else {}
    raw_query: dict[str, Any] = data.get("query") if isinstance(data.get("query"), dict) else {}
    raw_body = data.get("body")
    body_kind = str(data.get("bodyKind") or ("none" if raw_body is None else "json")).lower()
    timeout_sec = float(data.get("timeoutSec") or _DEFAULT_TIMEOUT_SEC)
    if timeout_sec <= 0:
        timeout_sec = _DEFAULT_TIMEOUT_SEC

    retries_raw = int(data.get("retries") or 0)
    retries = max(0, min(retries_raw, _MAX_RETRIES))
    retry_backoff_sec = float(data.get("retryBackoffSec") or 1.0)
    if retry_backoff_sec < 0:
        retry_backoff_sec = 1.0

    response_as = str(data.get("responseAs") or "auto").lower()
    expect_status_raw = data.get("expectStatus")
    expect_status: list[int] | None = None
    if isinstance(expect_status_raw, list):
        expect_status = [int(x) for x in expect_status_raw if isinstance(x, (int, float))]
        if not expect_status:
            expect_status = None

    headers_expanded: dict[str, str] = {}
    headers_redacted: dict[str, str] = {}
    for hk, hv in raw_headers.items():
        hv_str = str(hv)
        had_raw_secret = bool(_SECRET_RE.search(hv_str))
        expanded_final, had_secret = _expand_value_with_secrets_first(hv_str, ws, expr_ctx)
        if had_raw_secret or had_secret:
            headers_redacted[hk] = _REDACTED
        else:
            headers_redacted[hk] = expanded_final
        headers_expanded[hk] = expanded_final

    query_expanded: dict[str, str] = {}
    for qk, qv in raw_query.items():
        qv_str = str(qv)
        rendered, _ = _expand_value_with_secrets_first(qv_str, ws, expr_ctx)
        query_expanded[qk] = rendered

    final_url = _build_query_string(url_expanded, query_expanded)

    content: bytes | None = None
    content_type_header: str | None = None

    if body_kind not in ("none",) and raw_body is not None:
        if body_kind == "json":
            if isinstance(raw_body, dict):
                expanded_body = _expand_dict_values(raw_body, expr_ctx)
                content = json.dumps(expanded_body).encode("utf-8")
            elif isinstance(raw_body, str):
                expanded_body_str = _render_str(raw_body, expr_ctx)
                content = expanded_body_str.encode("utf-8")
            else:
                content = json.dumps(raw_body).encode("utf-8")
            content_type_header = "application/json"
        elif body_kind == "text":
            if isinstance(raw_body, str):
                content = _render_str(raw_body, expr_ctx).encode("utf-8")
            else:
                content = str(raw_body).encode("utf-8")
            content_type_header = "text/plain; charset=utf-8"
        elif body_kind == "form":
            if isinstance(raw_body, dict):
                form_data = _expand_dict_values(raw_body, expr_ctx)
                content = urlencode({str(k): str(v) for k, v in form_data.items()}).encode("utf-8")
            else:
                content = str(raw_body).encode("utf-8")
            content_type_header = "application/x-www-form-urlencoded"

    if content_type_header and "content-type" not in {k.lower() for k in headers_expanded}:
        headers_expanded["Content-Type"] = content_type_header

    # SSRF: validate the resolved IPs before any network I/O. Loopback is
    # only permitted when ``GC_API_CALL_ALLOW_INSECURE_LOCALHOST=1``; the
    # localhost check resolves the hostname against AF/IP families so that
    # ``127.0.0.1.attacker.com`` style names are not silently allowed.
    verify_ssl = True
    is_local = _is_localhost(final_url)
    allow_local = _allow_insecure_localhost()
    if is_local and allow_local:
        verify_ssl = False
    else:
        try:
            _validate_outbound_url(final_url)
        except ValueError as ssrf_exc:
            err_msg = str(ssrf_exc)
            emit(
                "process_complete",
                nodeId=node_id,
                graphId=graph_id,
                exitCode=0,
                timedOut=False,
                success=False,
                error=err_msg,
            )
            return False, {
                "processResult": {"success": False, "exitCode": 0, "timedOut": False, "error": err_msg},
                "apiCallResult": {"success": False, "error": err_msg},
            }

    redacted_url = _redact_secrets_in_str(url_expanded)
    emit(
        "api_call_invoke",
        nodeId=node_id,
        graphId=graph_id,
        method=method,
        url=redacted_url,
        attempt=attempt,
    )

    t_start = time.monotonic()
    last_error: str | None = None
    all_attempts = retries + 1
    _MAX_REDIRECTS = 5

    for try_num in range(all_attempts):
        if try_num > 0:
            sleep_sec = retry_backoff_sec * (2.0 ** (try_num - 1))
            emit(
                "api_call_retry",
                nodeId=node_id,
                graphId=graph_id,
                attempt=try_num,
                delaySec=sleep_sec,
            )
            time.sleep(sleep_sec)

        try:
            client_kwargs: dict[str, Any] = {
                "timeout": timeout_sec,
                "follow_redirects": False,
                "verify": verify_ssl,
                "max_redirects": _MAX_REDIRECTS,
            }
            if transport is not None:
                client_kwargs["transport"] = transport

            # Manual redirect loop so we re-validate each hop against the SSRF
            # blocklist (httpx does not expose a per-hop URL hook).
            with httpx.Client(**client_kwargs) as client:
                current_url = final_url
                current_method = method
                current_content = content
                current_headers = dict(headers_expanded)
                redirect_count = 0
                while True:
                    resp = client.request(
                        method=current_method,
                        url=current_url,
                        headers=current_headers,
                        content=current_content,
                    )
                    if resp.status_code in (301, 302, 303, 307, 308) and "location" in {
                        k.lower() for k in resp.headers
                    }:
                        if redirect_count >= _MAX_REDIRECTS:
                            raise httpx.TooManyRedirects(
                                f"exceeded {_MAX_REDIRECTS} redirects",
                                request=resp.request,
                            )
                        next_url = urljoin(str(resp.request.url), resp.headers["location"])
                        # Re-validate against SSRF blocklist on every hop.
                        next_is_local = _is_localhost(next_url)
                        if not (next_is_local and allow_local):
                            _validate_outbound_url(next_url)
                        # Per RFC: 301/302/303 typically downgrade to GET for
                        # cross-method redirects; 307/308 keep method+body.
                        if resp.status_code in (301, 302, 303) and current_method not in ("GET", "HEAD"):
                            current_method = "GET"
                            current_content = None
                            current_headers.pop("Content-Type", None)
                            current_headers.pop("content-type", None)
                        current_url = next_url
                        redirect_count += 1
                        continue
                    break

            elapsed_ms = int((time.monotonic() - t_start) * 1000)
            status = resp.status_code
            resp_headers = dict(resp.headers)
            resp_bytes = resp.content
            resp_ct = resp.headers.get("content-type", "")

            body_parsed = _parse_response_body(resp_bytes, response_as, resp_ct)

            if expect_status is not None:
                ok = status in expect_status
            else:
                ok = 200 <= status < 300

            if ok:
                ctx["last_result"] = {
                    "status": status,
                    "headers": resp_headers,
                    "body": body_parsed,
                    "elapsed_ms": elapsed_ms,
                }
                emit(
                    "process_complete",
                    nodeId=node_id,
                    graphId=graph_id,
                    exitCode=status,
                    timedOut=False,
                    success=True,
                )
                return True, {
                    "processResult": {"success": True, "exitCode": status, "timedOut": False},
                    "apiCallResult": {
                        "success": True,
                        "status": status,
                        "headers": resp_headers,
                        "body": body_parsed,
                        "elapsed_ms": elapsed_ms,
                    },
                }
            else:
                last_error = f"unexpected_status:{status}"
                if try_num + 1 >= all_attempts or (expect_status is not None):
                    body_for_err: Any
                    try:
                        body_for_err = json.loads(resp_bytes)
                    except Exception:
                        try:
                            body_for_err = resp_bytes.decode("utf-8", errors="replace")
                        except Exception:
                            body_for_err = None
                    ctx["last_result"] = False
                    emit(
                        "process_complete",
                        nodeId=node_id,
                        graphId=graph_id,
                        exitCode=status,
                        timedOut=False,
                        success=False,
                        error=last_error,
                    )
                    return False, {
                        "processResult": {
                            "success": False,
                            "exitCode": status,
                            "timedOut": False,
                            "error": last_error,
                        },
                        "apiCallResult": {
                            "success": False,
                            "status": status,
                            "headers": resp_headers,
                            "body": body_for_err,
                            "elapsed_ms": int((time.monotonic() - t_start) * 1000),
                            "error": {"status": status, "body": body_for_err},
                        },
                    }
                continue

        except httpx.TimeoutException as e:
            last_error = "timeout"
            if try_num + 1 >= all_attempts:
                elapsed_ms = int((time.monotonic() - t_start) * 1000)
                ctx["last_result"] = False
                emit(
                    "process_complete",
                    nodeId=node_id,
                    graphId=graph_id,
                    exitCode=0,
                    timedOut=True,
                    success=False,
                    error="timeout",
                )
                return False, {
                    "processResult": {"success": False, "exitCode": 0, "timedOut": True, "error": "timeout"},
                    "apiCallResult": {
                        "success": False,
                        "error": "timeout",
                        "elapsed_ms": elapsed_ms,
                    },
                }
        except httpx.RequestError as e:
            last_error = f"request_error:{type(e).__name__}"
            if try_num + 1 >= all_attempts:
                elapsed_ms = int((time.monotonic() - t_start) * 1000)
                ctx["last_result"] = False
                emit(
                    "process_complete",
                    nodeId=node_id,
                    graphId=graph_id,
                    exitCode=0,
                    timedOut=False,
                    success=False,
                    error=last_error,
                )
                return False, {
                    "processResult": {"success": False, "exitCode": 0, "timedOut": False, "error": last_error},
                    "apiCallResult": {
                        "success": False,
                        "error": last_error,
                        "elapsed_ms": elapsed_ms,
                    },
                }
        except ValueError as e:
            # SSRF validation failure during redirect chain. Do not retry.
            last_error = str(e)
            elapsed_ms = int((time.monotonic() - t_start) * 1000)
            ctx["last_result"] = False
            emit(
                "process_complete",
                nodeId=node_id,
                graphId=graph_id,
                exitCode=0,
                timedOut=False,
                success=False,
                error=last_error,
            )
            return False, {
                "processResult": {"success": False, "exitCode": 0, "timedOut": False, "error": last_error},
                "apiCallResult": {
                    "success": False,
                    "error": last_error,
                    "elapsed_ms": elapsed_ms,
                },
            }

    elapsed_ms = int((time.monotonic() - t_start) * 1000)
    ctx["last_result"] = False
    emit(
        "process_complete",
        nodeId=node_id,
        graphId=graph_id,
        exitCode=0,
        timedOut=False,
        success=False,
        error=last_error or "unknown",
    )
    return False, {
        "processResult": {"success": False, "exitCode": 0, "timedOut": False, "error": last_error or "unknown"},
        "apiCallResult": {"success": False, "error": last_error or "unknown", "elapsed_ms": elapsed_ms},
    }


def redact_api_call_data_for_execute(data: dict[str, Any]) -> dict[str, Any]:
    """Strip secret-bearing header values for ``node_execute`` events."""
    out = dict(data)
    raw_headers = out.get("headers")
    if isinstance(raw_headers, dict):
        redacted: dict[str, str] = {}
        for k, v in raw_headers.items():
            sv = str(v)
            if _SECRET_RE.search(sv):
                redacted[k] = _REDACTED
            else:
                redacted[k] = sv
        out["headers"] = redacted
    return out
