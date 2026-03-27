# Copyright Aura. All Rights Reserved.

from __future__ import annotations

import os
import shlex
import subprocess
import time
from pathlib import Path
from typing import Any, Callable

EmitFn = Callable[..., None]

_STDOUT_CAP = 256 * 1024


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


def _subprocess_env(data: dict[str, Any]) -> dict[str, str] | None:
    raw = data.get("env")
    if not isinstance(raw, dict) or not raw:
        return None
    out = dict(os.environ)
    for k, v in raw.items():
        out[str(k)] = "" if v is None else str(v)
    return out


def _int_non_negative(data: dict[str, Any], key: str, default: int) -> int:
    v = data.get(key)
    if v is None:
        return default
    try:
        x = int(v)
    except (TypeError, ValueError):
        return default
    return max(0, x)


def _eval_success(
    mode: str,
    *,
    returncode: int,
    stdout: str,
    cwd: Path,
    data: dict[str, Any],
) -> bool:
    m = (mode or "exit_code").strip().lower()
    if m in {"", "exit_code", "exitcode"}:
        codes = data.get("successExitCodes")
        if codes is None:
            ok = {0}
        elif isinstance(codes, list):
            ok = set()
            for x in codes:
                try:
                    ok.add(int(x))
                except (TypeError, ValueError):
                    pass
            if not ok:
                ok = {0}
        else:
            ok = {0}
        return returncode in ok
    if m in {"stdout", "stdout_contains"}:
        needle = data.get("stdoutContains") or data.get("stdout_contains")
        if needle is None:
            return False
        return str(needle) in stdout
    if m in {"marker_file", "markerfile"}:
        rel = data.get("markerFile") or data.get("marker_file")
        if not rel:
            return False
        path = (cwd / str(rel)).resolve()
        try:
            return path.is_file()
        except OSError:
            return False
    return False


def run_task_process(
    *,
    node_id: str,
    graph_id: str,
    data: dict[str, Any],
    ctx: dict[str, Any],
    emit: EmitFn,
) -> bool:
    argv = _argv_from_data(data)
    if not argv:
        return True

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
    subproc_env = _subprocess_env(data)

    attempt = 0
    while True:
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
            return False

        timed_out = False
        try:
            if timeout is not None:
                out_b, err_b = proc.communicate(timeout=timeout)
            else:
                out_b, err_b = proc.communicate()
        except subprocess.TimeoutExpired:
            timed_out = True
            proc.kill()
            out_b, err_b = proc.communicate()

        rc = int(proc.returncode if proc.returncode is not None else -1)
        stdout = (out_b or "")[:_STDOUT_CAP]
        stderr = (err_b or "")[:_STDOUT_CAP]

        if timed_out:
            emit(
                "process_complete",
                nodeId=node_id,
                graphId=graph_id,
                exitCode=rc,
                timedOut=True,
                attempt=attempt,
                stdoutTail=stdout[-2000:] if stdout else "",
                stderrTail=stderr[-2000:] if stderr else "",
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

        if ok:
            ctx["last_result"] = True
            out_map = ctx.setdefault("node_outputs", {})
            entry = out_map.setdefault(node_id, {})
            if isinstance(entry, dict):
                entry["processResult"] = {
                    "exitCode": rc,
                    "stdoutChars": len(stdout),
                    "stderrChars": len(stderr),
                }
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
