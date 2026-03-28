# Copyright GraphCaster. All Rights Reserved.

"""Blocking helpers for one MCP ``tools/call`` (stdio or streamable HTTP)."""

from __future__ import annotations

import copy
import inspect
import json
import os
import re
import shlex
import urllib.parse
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from typing import Any, Callable, Mapping

import anyio

from graph_caster.process_exec import _build_task_subprocess_env, _parse_env_keys_list

_SENSITIVE_KEY_RE = re.compile(
    r"(apikey|api_key|secret|token|password|auth|bearer)$",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class McpToolCallOutcome:
    ok: bool
    result: Any | None
    error: str | None
    code: str | None


def _truncate_str(s: str, max_bytes: int) -> str:
    raw = s.encode("utf-8")
    if len(raw) <= max_bytes:
        return s
    cut = max_bytes
    while cut > 0 and (raw[cut - 1] & 0xC0) == 0x80:
        cut -= 1
    return raw[:cut].decode("utf-8", errors="ignore") + "…"


def _redact_object_for_event(obj: Any, max_depth: int, max_bytes: int) -> Any:
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
                out[ks] = _redact_object_for_event(v, max_depth - 1, max_bytes)
        return out
    if isinstance(obj, list):
        return [_redact_object_for_event(x, max_depth - 1, max_bytes) for x in obj[:200]]
    if isinstance(obj, str):
        return _truncate_str(obj, min(max_bytes, 8192))
    return obj


def redact_mcp_tool_arguments_for_event(arguments: Mapping[str, Any] | None) -> dict[str, Any]:
    if not arguments:
        return {}
    return dict(_redact_object_for_event(dict(arguments), max_depth=6, max_bytes=65536))  # type: ignore[arg-type]


def redact_mcp_tool_data_for_execute(data: dict[str, Any]) -> dict[str, Any]:
    keys = _parse_env_keys_list(data.get("envKeys"))
    if not keys:
        return data
    out = copy.deepcopy(data)
    env = out.get("env")
    if isinstance(env, dict):
        for k in keys:
            sk = str(k)
            if sk in env:
                env[sk] = "[redacted]"
    return out


def _argv_from_mcp_data(data: dict[str, Any]) -> list[str] | None:
    raw = data.get("command")
    if raw is None:
        raw = data.get("argv")
    if raw is None:
        return None
    if isinstance(raw, list):
        return [str(x) for x in raw]
    if isinstance(raw, str):
        posix = os.name != "nt"
        return [str(x) for x in shlex.split(raw, posix=posix)]
    return None


def _resolve_mcp_cwd(data: dict[str, Any], ctx: dict[str, Any]) -> Path | None:
    raw = data.get("cwd")
    if raw is None or str(raw).strip() == "":
        return None
    p = Path(str(raw))
    if p.is_absolute():
        return p
    base = ctx.get("root_run_artifact_dir")
    if base:
        return (Path(base) / p).resolve()
    return (Path.cwd() / p).resolve()


def validate_mcp_http_url(url: str, *, allow_insecure_localhost: bool) -> str | None:
    t = url.strip()
    if not t:
        return "empty_url"
    try:
        parsed = urllib.parse.urlparse(t)
    except Exception:
        return "bad_url"
    scheme = (parsed.scheme or "").lower()
    host = (parsed.hostname or "").lower()
    if scheme == "https":
        return None
    if scheme == "http":
        if not allow_insecure_localhost:
            return "http_requires_allow_insecure_localhost"
        if host in ("localhost", "127.0.0.1", "::1"):
            return None
        return "http_only_for_localhost"
    return "unsupported_scheme"


def normalize_mcp_provider_outcome(raw: Any) -> McpToolCallOutcome:
    if not isinstance(raw, dict):
        return McpToolCallOutcome(False, None, "provider_returned_non_object", "bad_provider")
    if bool(raw.get("ok")):
        return McpToolCallOutcome(True, raw.get("result"), None, None)
    err = raw.get("error")
    code = raw.get("code")
    return McpToolCallOutcome(
        False,
        None,
        str(err) if err is not None else "unknown_error",
        str(code) if code is not None else None,
    )


def _bearer_token_from_data(data: dict[str, Any], env: Mapping[str, str]) -> str | None:
    explicit = str(data.get("bearerEnvKey") or "").strip()
    keys = _parse_env_keys_list(data.get("envKeys"))
    name: str | None = explicit if explicit else None
    if not name and len(keys) == 1:
        name = keys[0]
    if not name:
        return None
    v = env.get(name)
    if v is None or str(v).strip() == "":
        return None
    return str(v)


def _call_tool_result_to_json(ctr: Any) -> Any:
    if ctr.structuredContent is not None:
        return ctr.structuredContent
    dumped = ctr.model_dump(mode="json")
    texts: list[str] = []
    for block in ctr.content or []:
        bdump = block.model_dump(mode="json") if hasattr(block, "model_dump") else {}
        if isinstance(bdump, dict) and bdump.get("type") == "text" and isinstance(bdump.get("text"), str):
            texts.append(bdump["text"])
    if texts:
        return {"text": "\n".join(texts), "content": dumped.get("content"), "isError": dumped.get("isError")}
    return dumped


async def _session_call_tool(
    read_stream: Any,
    write_stream: Any,
    tool_name: str,
    arguments: dict[str, Any] | None,
    timeout_sec: float,
) -> McpToolCallOutcome:
    from mcp import ClientSession

    read_timeout = timedelta(seconds=max(timeout_sec, 0.1))
    async with ClientSession(read_stream, write_stream, read_timeout_seconds=read_timeout) as session:
        await session.initialize()
        try:
            ctr = await session.call_tool(
                tool_name,
                arguments or {},
                read_timeout_seconds=read_timeout,
            )
        except Exception as e:
            return McpToolCallOutcome(False, None, str(e)[:2000], "call_tool_exception")
        if getattr(ctr, "isError", False):
            payload = _call_tool_result_to_json(ctr)
            return McpToolCallOutcome(False, payload, "tool_returned_isError", "tool_error")
        return McpToolCallOutcome(True, _call_tool_result_to_json(ctr), None, None)


async def _call_stdio_async(
    data: dict[str, Any],
    ctx: dict[str, Any],
    *,
    tool_name: str,
    arguments: dict[str, Any] | None,
    timeout_sec: float,
    process_env: dict[str, str],
) -> McpToolCallOutcome:
    from mcp.client.stdio import StdioServerParameters, stdio_client

    argv = _argv_from_mcp_data(data)
    if not argv:
        return McpToolCallOutcome(False, None, "missing_command_or_argv", "config")
    cmd = argv[0]
    args = argv[1:] if len(argv) > 1 else []
    cwd_path = _resolve_mcp_cwd(data, ctx)
    cwd_s: str | None = str(cwd_path) if cwd_path is not None else None
    params = StdioServerParameters(command=cmd, args=args, env=process_env, cwd=cwd_s)
    try:
        with anyio.fail_after(timeout_sec):
            async with stdio_client(params) as (read_stream, write_stream):
                return await _session_call_tool(
                    read_stream, write_stream, tool_name, arguments, timeout_sec
                )
    except TimeoutError:
        return McpToolCallOutcome(False, None, "mcp_stdio_timeout", "timeout")
    except OSError as e:
        return McpToolCallOutcome(False, None, str(e)[:2000], "stdio_os_error")
    except Exception as e:
        return McpToolCallOutcome(False, None, str(e)[:2000], "stdio_error")


async def _call_streamable_http_async(
    data: dict[str, Any],
    *,
    tool_name: str,
    arguments: dict[str, Any] | None,
    timeout_sec: float,
    process_env: dict[str, str],
) -> McpToolCallOutcome:
    import httpx

    from mcp.client.streamable_http import streamable_http_client

    url = str(data.get("serverUrl") or "").strip()
    allow_insecure = bool(data.get("allowInsecureLocalhost"))
    v_err = validate_mcp_http_url(url, allow_insecure_localhost=allow_insecure)
    if v_err:
        return McpToolCallOutcome(False, None, v_err, "bad_url")

    token = _bearer_token_from_data(data, process_env)
    headers: dict[str, str] = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    timeout = httpx.Timeout(timeout_sec, read=timeout_sec)
    try:
        async with httpx.AsyncClient(headers=headers, timeout=timeout) as client:
            async with streamable_http_client(url, http_client=client) as (read_stream, write_stream, _gid):
                with anyio.fail_after(timeout_sec):
                    return await _session_call_tool(
                        read_stream, write_stream, tool_name, arguments, timeout_sec
                    )
    except TimeoutError:
        return McpToolCallOutcome(False, None, "mcp_http_timeout", "timeout")
    except Exception as e:
        return McpToolCallOutcome(False, None, str(e)[:2000], "http_error")


async def _run_mcp_tool_async(
    *,
    data: dict[str, Any],
    ctx: dict[str, Any],
    graph_id: str,
    node_id: str,
    workspace_secrets: Mapping[str, str] | None,
    tool_name: str,
    arguments: dict[str, Any] | None,
    timeout_sec: float,
    provider: Callable[..., Any] | None,
) -> McpToolCallOutcome:
    rid = str(ctx.get("run_id") or "")
    transport = str(data.get("transport") or "stdio").strip()

    built = _build_task_subprocess_env(data, workspace_secrets)
    process_env: dict[str, str] = dict(os.environ) if built is None else built

    if provider is not None:
        payload = {
            "toolName": tool_name,
            "arguments": arguments or {},
            "transport": transport,
            "runId": rid,
            "graphId": graph_id,
            "nodeId": node_id,
            "data": {k: v for k, v in data.items() if k != "arguments"},
        }
        try:
            raw = provider(payload)
            if inspect.isawaitable(raw):
                raw = await raw
        except Exception as e:
            return McpToolCallOutcome(False, None, str(e)[:2000], "provider_exception")
        return normalize_mcp_provider_outcome(raw)

    try:
        import mcp.client.stdio  # noqa: F401
    except ImportError:
        return McpToolCallOutcome(
            False,
            None,
            "mcp package not installed (pip install 'graph-caster[mcp]')",
            "import_error",
        )

    if transport == "streamable_http":
        return await _call_streamable_http_async(
            data,
            tool_name=tool_name,
            arguments=arguments,
            timeout_sec=timeout_sec,
            process_env=process_env,
        )
    if transport == "stdio":
        return await _call_stdio_async(
            data,
            ctx,
            tool_name=tool_name,
            arguments=arguments,
            timeout_sec=timeout_sec,
            process_env=process_env,
        )
    return McpToolCallOutcome(False, None, f"unknown_transport:{transport}", "config")


def run_mcp_tool_call(
    *,
    data: dict[str, Any],
    ctx: dict[str, Any],
    graph_id: str,
    node_id: str,
    workspace_secrets: Mapping[str, str] | None,
    tool_name: str,
    arguments: dict[str, Any] | None,
    timeout_sec: float,
    provider: Callable[..., Any] | None,
) -> McpToolCallOutcome:
    async def _main() -> McpToolCallOutcome:
        return await _run_mcp_tool_async(
            data=data,
            ctx=ctx,
            graph_id=graph_id,
            node_id=node_id,
            workspace_secrets=workspace_secrets,
            tool_name=tool_name,
            arguments=arguments,
            timeout_sec=timeout_sec,
            provider=provider,
        )

    try:
        return anyio.run(_main)
    except RuntimeError as e:
        msg = str(e)
        if "asyncio.run()" in msg or "anyio.run()" in msg or "event loop" in msg.lower():
            return McpToolCallOutcome(False, None, msg[:500], "event_loop")
        raise


def format_mcp_result_preview(result: Any, *, max_chars: int = 2048) -> str:
    try:
        s = json.dumps(result, ensure_ascii=False, separators=(",", ":"))
    except (TypeError, ValueError):
        s = str(result)
    if len(s) <= max_chars:
        return s
    return s[: max_chars - 1] + "…"
