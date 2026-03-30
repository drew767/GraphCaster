# Copyright GraphCaster. All Rights Reserved.

"""Subprocess-isolated Python execution for ``python_code`` nodes."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from typing import Any, Callable

from graph_caster.expression.templates import render_template
from graph_caster.runner.expression_conditions import runner_predicate_to_expression_context

EmitFn = Callable[..., None]

_MAX_CODE_BYTES = 256 * 1024
_MAX_CONTEXT_JSON_BYTES = 512 * 1024
_DEFAULT_TIMEOUT = 30.0
_STDIO_CAPTURE_MAX = 16 * 1024


def _template_context(ctx: dict[str, Any]) -> dict[str, Any]:
    return dict(runner_predicate_to_expression_context(ctx))


def _float_data(data: dict[str, Any], key: str, default: float) -> float:
    v = data.get(key, default)
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def redact_python_code_data_for_execute(data: dict[str, Any]) -> dict[str, Any]:
    """Trim very large ``code`` strings in ``node_execute`` payloads."""
    out = dict(data)
    c = out.get("code")
    if isinstance(c, str) and len(c) > 8000:
        out["code"] = c[:8000] + "…<truncated>"
    return out


def _worker_argv() -> list[str]:
    return [sys.executable, "-I", "-m", "graph_caster.code_node_worker"]


def build_worker_context(ctx: dict[str, Any]) -> dict[str, Any]:
    rv = ctx.get("run_variables")
    if not isinstance(rv, dict):
        rv = {}
    lr = ctx.get("last_result")
    payload: dict[str, Any] = {"run_variables": rv, "last_result": lr}
    raw = json.dumps(payload, default=str)
    if len(raw.encode("utf-8")) > _MAX_CONTEXT_JSON_BYTES:
        payload = {"run_variables": rv, "last_result": None}
    return payload


def execute_python_code(
    *,
    node_id: str,
    graph_id: str,
    data: dict[str, Any],
    ctx: dict[str, Any],
    emit: EmitFn,
    attempt: int = 0,
    should_cancel: Callable[[], bool] | None = None,
) -> tuple[bool, dict[str, Any]]:
    """Run user code in a child interpreter. Emits ``process_complete`` (exitCode 0/1, not HTTP status)."""
    tmpl_ctx = _template_context(ctx)
    raw_code = data.get("code")
    if not isinstance(raw_code, str) or not raw_code.strip():
        emit(
            "process_complete",
            nodeId=node_id,
            graphId=graph_id,
            exitCode=0,
            timedOut=False,
            attempt=attempt,
            success=False,
            stdoutTail="",
            stderrTail="python_code_empty",
        )
        err = "python_code_empty"
        return False, {
            "processResult": {
                "success": False,
                "exitCode": 0,
                "timedOut": False,
                "error": err,
            },
            "codeResult": {"success": False, "error": err, "result": None},
        }

    code = render_template(raw_code.strip(), tmpl_ctx)
    if len(code.encode("utf-8")) > _MAX_CODE_BYTES:
        emit(
            "process_complete",
            nodeId=node_id,
            graphId=graph_id,
            exitCode=1,
            timedOut=False,
            attempt=attempt,
            success=False,
            stdoutTail="",
            stderrTail="python_code_too_large",
        )
        err = "python_code_too_large"
        return False, {
            "processResult": {
                "success": False,
                "exitCode": 1,
                "timedOut": False,
                "error": err,
            },
            "codeResult": {"success": False, "error": err, "result": None},
        }

    timeout = max(0.5, _float_data(data, "timeoutSec", _DEFAULT_TIMEOUT))
    wctx = build_worker_context(ctx)
    line = json.dumps({"code": code, "context": wctx}, ensure_ascii=False, default=str) + "\n"

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
            stderrTail="cancelled_before_execute",
        )
        return False, {
            "processResult": {
                "success": False,
                "exitCode": 0,
                "timedOut": False,
                "cancelled": True,
                "error": "cancelled_before_execute",
            },
            "codeResult": {"success": False, "error": "cancelled_before_execute", "result": None},
        }

    kw: dict[str, Any] = {}
    if os.name == "nt":
        cf = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        if cf:
            kw["creationflags"] = cf

    t0 = time.monotonic()
    try:
        proc = subprocess.run(
            _worker_argv(),
            input=line,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            **kw,
        )
    except subprocess.TimeoutExpired:
        dur_ms = int((time.monotonic() - t0) * 1000)
        emit(
            "process_complete",
            nodeId=node_id,
            graphId=graph_id,
            exitCode=1,
            timedOut=True,
            attempt=attempt,
            success=False,
            durationMs=dur_ms,
            stdoutTail="",
            stderrTail="timeout",
        )
        ctx["last_result"] = False
        return False, {
            "processResult": {
                "success": False,
                "exitCode": 1,
                "timedOut": True,
                "error": "timeout",
            },
            "codeResult": {"success": False, "error": "timeout", "result": None},
        }

    dur_ms = int((time.monotonic() - t0) * 1000)
    out_first = ""
    if proc.stdout:
        for ln in proc.stdout.splitlines():
            s = ln.strip()
            if s:
                out_first = s
                break
    err_tail = (proc.stderr or "")[-_STDIO_CAPTURE_MAX:]

    if proc.returncode != 0:
        msg = f"worker_exit_{proc.returncode}"
        emit(
            "process_complete",
            nodeId=node_id,
            graphId=graph_id,
            exitCode=1,
            timedOut=False,
            attempt=attempt,
            success=False,
            durationMs=dur_ms,
            stdoutTail=out_first[:4000] if out_first else "",
            stderrTail=(msg + " " + err_tail).strip()[:4000],
        )
        ctx["last_result"] = False
        return False, {
            "processResult": {
                "success": False,
                "exitCode": 1,
                "timedOut": False,
                "error": msg,
            },
            "codeResult": {"success": False, "error": msg, "result": None, "stderr": err_tail},
        }

    if not out_first:
        emit(
            "process_complete",
            nodeId=node_id,
            graphId=graph_id,
            exitCode=1,
            timedOut=False,
            attempt=attempt,
            success=False,
            durationMs=dur_ms,
            stdoutTail="",
            stderrTail=(err_tail or "empty_worker_stdout").strip()[:4000],
        )
        ctx["last_result"] = False
        return False, {
            "processResult": {
                "success": False,
                "exitCode": 1,
                "timedOut": False,
                "error": "empty_worker_stdout",
            },
            "codeResult": {"success": False, "error": "empty_worker_stdout", "result": None},
        }

    try:
        parsed = json.loads(out_first)
    except json.JSONDecodeError as e:
        emit(
            "process_complete",
            nodeId=node_id,
            graphId=graph_id,
            exitCode=1,
            timedOut=False,
            attempt=attempt,
            success=False,
            durationMs=dur_ms,
            stdoutTail=out_first[:4000],
            stderrTail=str(e)[:4000],
        )
        ctx["last_result"] = False
        return False, {
            "processResult": {
                "success": False,
                "exitCode": 1,
                "timedOut": False,
                "error": "invalid_worker_json",
            },
            "codeResult": {"success": False, "error": "invalid_worker_json", "result": None},
        }

    if not isinstance(parsed, dict):
        emit(
            "process_complete",
            nodeId=node_id,
            graphId=graph_id,
            exitCode=1,
            timedOut=False,
            attempt=attempt,
            success=False,
            durationMs=dur_ms,
            stdoutTail=out_first[:4000],
            stderrTail="worker_bad_shape",
        )
        ctx["last_result"] = False
        return False, {
            "processResult": {
                "success": False,
                "exitCode": 1,
                "timedOut": False,
                "error": "worker_bad_shape",
            },
            "codeResult": {"success": False, "error": "worker_bad_shape", "result": None},
        }

    if not parsed.get("ok"):
        err_s = str(parsed.get("error") or "worker_error")
        tb = str(parsed.get("traceback") or "")
        stderr_msg = (err_s + ("\n" + tb if tb else ""))[:4000]
        emit(
            "process_complete",
            nodeId=node_id,
            graphId=graph_id,
            exitCode=1,
            timedOut=False,
            attempt=attempt,
            success=False,
            durationMs=dur_ms,
            stdoutTail="",
            stderrTail=stderr_msg,
        )
        ctx["last_result"] = False
        return False, {
            "processResult": {
                "success": False,
                "exitCode": 1,
                "timedOut": False,
                "error": err_s,
            },
            "codeResult": {
                "success": False,
                "error": err_s,
                "result": None,
                "traceback": tb or None,
            },
        }

    res = parsed.get("result")
    rv_w: dict[str, Any] | None = None
    raw_rv = parsed.get("run_variables")
    if isinstance(raw_rv, dict) and raw_rv:
        rv_w = dict(raw_rv)

    emit(
        "process_complete",
        nodeId=node_id,
        graphId=graph_id,
        exitCode=0,
        timedOut=False,
        attempt=attempt,
        success=True,
        durationMs=dur_ms,
        stdoutTail="",
        stderrTail=err_tail[-4000:] if err_tail else "",
    )

    ctx["last_result"] = res
    patch: dict[str, Any] = {
        "processResult": {
            "success": True,
            "exitCode": 0,
            "timedOut": False,
            "error": None,
        },
        "codeResult": {"success": True, "error": None, "result": res},
    }
    if rv_w:
        patch["runVariables"] = rv_w
    return True, patch
