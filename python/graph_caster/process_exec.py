# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import os
import shlex
import subprocess
import time
from collections.abc import Mapping
from pathlib import Path
from typing import Any, Callable

from graph_caster.exec.env_merge import (
    _ENV_KEY_NAME_RE,
    _build_task_subprocess_env,
    _parse_env_keys_list,
    redact_task_data_for_node_execute,
    task_declares_env_keys,
)
from graph_caster.exec.io_pump import (
    EmitFn,
    _communicate_with_streaming,
)
from graph_caster.exec.llm_agent_process import run_llm_agent_process
from graph_caster.exec.process_errors import (
    _eval_success,
    _record_task_process_result,
)

__all__ = [
    "run_task_process",
    "run_llm_agent_process",
    "task_declares_env_keys",
    "redact_task_data_for_node_execute",
    "_argv_from_data",
    "_build_task_subprocess_env",
    "_parse_env_keys_list",
    "_ENV_KEY_NAME_RE",
    "EmitFn",
]


def _argv_from_data(data: dict[str, Any]) -> list[str] | None:
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


def _resolve_argv_and_optional_preset_cwd(
    data: dict[str, Any], ctx: dict[str, Any]
) -> tuple[list[str] | None, Path | None, str | None]:
    """
    Returns ``(argv, preset_cwd, error)``.
    ``error`` is set when ``gcCursorAgent`` is present but invalid or the CLI is missing.
    """
    argv = _argv_from_data(data)
    if argv:
        return argv, None, None
    if "gcCursorAgent" not in data:
        return None, None, None
    gca = data.get("gcCursorAgent")
    if not isinstance(gca, dict):
        return None, None, "gcCursorAgent must be an object"
    from graph_caster.cursor_agent_argv import (
        CursorAgentPresetError,
        build_argv_and_cwd_for_gc_cursor_agent,
        validate_gc_cursor_agent_errors,
    )

    errs = validate_gc_cursor_agent_errors(data)
    if errs:
        return None, None, "; ".join(errs)
    try:
        built, cwd_b = build_argv_and_cwd_for_gc_cursor_agent(data, ctx)
        return built, cwd_b, None
    except CursorAgentPresetError as e:
        return None, None, str(e)


def _resolve_cwd(data: dict[str, Any], ctx: dict[str, Any]) -> Path:
    raw = data.get("cwd")
    if raw is None or str(raw).strip() == "":
        rrd = ctx.get("root_run_artifact_dir")
        if rrd:
            return Path(rrd)
        return Path.cwd()
    p = Path(str(raw))
    if p.is_absolute():
        return p
    base = ctx.get("root_run_artifact_dir")
    if base:
        return (Path(base) / p).resolve()
    return (Path.cwd() / p).resolve()


def _float_positive(data: dict[str, Any], key: str, default: float | None) -> float | None:
    v = data.get(key)
    if v is None:
        return default
    try:
        x = float(v)
    except (TypeError, ValueError):
        return default
    if x <= 0:
        return default
    return x


def _int_non_negative(data: dict[str, Any], key: str, default: int) -> int:
    v = data.get(key)
    if v is None:
        return default
    try:
        x = int(v)
    except (TypeError, ValueError):
        return default
    return max(0, x)


def run_task_process(
    *,
    node_id: str,
    graph_id: str,
    data: dict[str, Any],
    ctx: dict[str, Any],
    emit: EmitFn,
    should_cancel: Callable[[], bool] | None = None,
    workspace_secrets: Mapping[str, str] | None = None,
) -> bool:
    argv, preset_cwd, preset_err = _resolve_argv_and_optional_preset_cwd(data, ctx)
    if preset_err:
        emit(
            "process_failed",
            nodeId=node_id,
            graphId=graph_id,
            reason="spawn_error",
            message=preset_err,
            attempt=0,
        )
        ctx["last_result"] = False
        _record_task_process_result(
            ctx,
            node_id,
            exit_code=-1,
            success=False,
            timed_out=False,
            stdout="",
            stderr="",
            cancelled=False,
        )
        return False
    if not argv:
        return True

    raw_cwd = data.get("cwd")
    explicit_cwd = isinstance(raw_cwd, str) and raw_cwd.strip() != ""
    if explicit_cwd:
        cwd = _resolve_cwd(data, ctx)
    elif preset_cwd is not None:
        cwd = preset_cwd
    else:
        cwd = _resolve_cwd(data, ctx)
    try:
        cwd.mkdir(parents=True, exist_ok=True)
    except OSError:
        pass

    timeout = _float_positive(data, "timeoutSec", None)
    if timeout is None:
        timeout = _float_positive(data, "timeout_seconds", None)
    retries = _int_non_negative(data, "retryCount", 0)
    if "maxRetries" in data:
        retries = max(retries, _int_non_negative(data, "maxRetries", 0))
    backoff = _float_positive(data, "retryBackoffSec", 1.0) or 1.0
    success_mode = str(data.get("successMode") or data.get("success_mode") or "exit_code")
    subproc_env = _build_task_subprocess_env(data, workspace_secrets)

    attempt = 0
    while True:
        if should_cancel is not None and should_cancel():
            ctx["last_result"] = False
            ctx["_gc_process_cancelled"] = True
            return False
        emit(
            "process_spawn",
            nodeId=node_id,
            graphId=graph_id,
            argv=argv,
            cwd=str(cwd),
            attempt=attempt,
        )
        try:
            proc = subprocess.Popen(
                argv,
                cwd=str(cwd),
                env=subproc_env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
        except OSError as e:
            emit(
                "process_failed",
                nodeId=node_id,
                graphId=graph_id,
                reason="spawn_error",
                message=str(e),
                attempt=attempt,
            )
            ctx["last_result"] = False
            _record_task_process_result(
                ctx,
                node_id,
                exit_code=-1,
                success=False,
                timed_out=False,
                stdout="",
                stderr="",
                cancelled=False,
            )
            return False

        stdout, stderr, timed_out, cancelled = _communicate_with_streaming(
            proc,
            emit,
            node_id=node_id,
            graph_id=graph_id,
            attempt=attempt,
            timeout=timeout,
            should_cancel=should_cancel,
        )

        rc = int(proc.returncode if proc.returncode is not None else -1)

        if cancelled:
            emit(
                "process_complete",
                nodeId=node_id,
                graphId=graph_id,
                exitCode=rc,
                timedOut=False,
                attempt=attempt,
                success=False,
                cancelled=True,
                stdoutTail=stdout[-2000:] if stdout else "",
                stderrTail=stderr[-2000:] if stderr else "",
            )
            _record_task_process_result(
                ctx,
                node_id,
                exit_code=rc,
                success=False,
                timed_out=False,
                stdout=stdout,
                stderr=stderr,
                cancelled=True,
            )
            ctx["last_result"] = False
            ctx["_gc_process_cancelled"] = True
            return False

        if timed_out:
            emit(
                "process_complete",
                nodeId=node_id,
                graphId=graph_id,
                exitCode=rc,
                timedOut=True,
                attempt=attempt,
                success=False,
                stdoutTail=stdout[-2000:] if stdout else "",
                stderrTail=stderr[-2000:] if stderr else "",
            )
            _record_task_process_result(
                ctx,
                node_id,
                exit_code=rc,
                success=False,
                timed_out=True,
                stdout=stdout,
                stderr=stderr,
                cancelled=False,
            )
            if attempt < retries:
                emit(
                    "process_retry",
                    nodeId=node_id,
                    graphId=graph_id,
                    attempt=attempt + 1,
                    delaySec=backoff,
                    reason="timeout",
                )
                time.sleep(backoff)
                attempt += 1
                continue
            emit(
                "process_failed",
                nodeId=node_id,
                graphId=graph_id,
                reason="timeout",
                message="subprocess timed out",
                attempt=attempt,
            )
            ctx["last_result"] = False
            return False

        ok = _eval_success(success_mode, returncode=rc, stdout=stdout, cwd=cwd, data=data)
        emit(
            "process_complete",
            nodeId=node_id,
            graphId=graph_id,
            exitCode=rc,
            timedOut=False,
            attempt=attempt,
            success=ok,
            stdoutTail=stdout[-2000:] if stdout else "",
            stderrTail=stderr[-2000:] if stderr else "",
        )
        _record_task_process_result(
            ctx,
            node_id,
            exit_code=rc,
            success=ok,
            timed_out=False,
            stdout=stdout,
            stderr=stderr,
            cancelled=False,
        )

        if ok:
            ctx["last_result"] = True
            return True

        if attempt < retries:
            emit(
                "process_retry",
                nodeId=node_id,
                graphId=graph_id,
                attempt=attempt + 1,
                delaySec=backoff,
                reason="unsuccessful",
            )
            time.sleep(backoff)
            attempt += 1
            continue

        emit(
            "process_failed",
            nodeId=node_id,
            graphId=graph_id,
            reason="unsuccessful",
            message=f"exit {rc}, mode={success_mode!r}",
            attempt=attempt,
        )
        ctx["last_result"] = False
        return False
