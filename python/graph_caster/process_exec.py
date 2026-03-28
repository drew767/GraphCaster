# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import os
import queue
import shlex
import subprocess
import threading
import time
import warnings
from pathlib import Path
from typing import Any, Callable

from graph_caster.cursor_agent_argv import MAX_CHAINED_PROCESS_OUTPUT_TEXT_LEN

EmitFn = Callable[..., None]

_STDOUT_CAP = 256 * 1024
_CANCEL_POLL_SEC = 0.25
_CANCEL_JOIN_TIMEOUT_SEC = 120.0
_STREAM_READER_JOIN_SEC = 5.0
_MAX_READLINE_CHARS = 32768
_STREAM_QUEUE_MAX = 8192


def _truncate_for_process_result_storage(s: str, max_len: int) -> str:
    if len(s) <= max_len:
        return s
    if max_len <= 3:
        return s[:max_len]
    return s[: max_len - 3] + "..."


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


def _communicate_with_cancel(
    proc: subprocess.Popen,
    timeout: float | None,
    should_cancel: Callable[[], bool],
    *,
    poll_sec: float = _CANCEL_POLL_SEC,
) -> tuple[str, str, bool, bool]:
    lock = threading.Lock()
    state: dict[str, Any] = {"done": False, "out": "", "err": "", "timed_out": False}

    def worker() -> None:
        timed_out = False
        out_b, err_b = "", ""
        try:
            try:
                o, e = proc.communicate(timeout=timeout)
                out_b, err_b = o or "", e or ""
            except subprocess.TimeoutExpired:
                timed_out = True
                proc.kill()
                o, e = proc.communicate()
                out_b, err_b = o or "", e or ""
        finally:
            with lock:
                state["out"] = out_b
                state["err"] = err_b
                state["timed_out"] = timed_out
                state["done"] = True

    th = threading.Thread(target=worker, daemon=True)
    th.start()
    while True:
        with lock:
            if state["done"]:
                return (state["out"], state["err"], state["timed_out"], False)
        if should_cancel():
            proc.kill()
            th.join(timeout=_CANCEL_JOIN_TIMEOUT_SEC)
            if th.is_alive():
                warnings.warn(
                    "subprocess communicate thread still alive after cancel join timeout",
                    RuntimeWarning,
                    stacklevel=2,
                )
            with lock:
                return (state["out"], state["err"], state["timed_out"], True)
        th.join(timeout=poll_sec)


def _pipe_reader_lines_to_queue(
    pipe: Any,
    stream_label: str,
    q: "queue.Queue[tuple[str, str, bool]]",
) -> None:
    if pipe is None:
        return
    try:
        while True:
            line = pipe.readline()
            if line == "":
                break
            if len(line) > _MAX_READLINE_CHARS:
                line = line[:_MAX_READLINE_CHARS]
            eol = line.endswith("\n")
            q.put((stream_label, line, eol))
    except (BrokenPipeError, ValueError, OSError):
        pass


def _emit_one_process_output(
    name: str,
    text: str,
    eol: bool,
    out_parts: list[str],
    err_parts: list[str],
    emit: EmitFn,
    *,
    node_id: str,
    graph_id: str,
    attempt: int,
    seq: dict[str, int],
) -> None:
    if name == "stdout":
        out_parts.append(text)
        sn = seq["stdout"]
        emit(
            "process_output",
            nodeId=node_id,
            graphId=graph_id,
            stream="stdout",
            text=text,
            seq=sn,
            attempt=attempt,
            eol=eol,
        )
        seq["stdout"] = sn + 1
    else:
        err_parts.append(text)
        sn = seq["stderr"]
        emit(
            "process_output",
            nodeId=node_id,
            graphId=graph_id,
            stream="stderr",
            text=text,
            seq=sn,
            attempt=attempt,
            eol=eol,
        )
        seq["stderr"] = sn + 1


def _drain_process_output_queue(
    q: "queue.Queue[tuple[str, str, bool]]",
    out_parts: list[str],
    err_parts: list[str],
    emit: EmitFn,
    *,
    node_id: str,
    graph_id: str,
    attempt: int,
    seq: dict[str, int],
) -> None:
    while True:
        try:
            name, text, eol = q.get_nowait()
        except queue.Empty:
            break
        _emit_one_process_output(
            name,
            text,
            eol,
            out_parts,
            err_parts,
            emit,
            node_id=node_id,
            graph_id=graph_id,
            attempt=attempt,
            seq=seq,
        )


def _communicate_with_streaming(
    proc: subprocess.Popen[str],
    emit: EmitFn,
    *,
    node_id: str,
    graph_id: str,
    attempt: int,
    timeout: float | None,
    should_cancel: Callable[[], bool] | None,
) -> tuple[str, str, bool, bool]:
    q: queue.Queue[tuple[str, str, bool]] = queue.Queue(maxsize=_STREAM_QUEUE_MAX)
    out_parts: list[str] = []
    err_parts: list[str] = []
    seq = {"stdout": 0, "stderr": 0}
    t_out = threading.Thread(
        target=_pipe_reader_lines_to_queue,
        args=(proc.stdout, "stdout", q),
        daemon=True,
    )
    t_err = threading.Thread(
        target=_pipe_reader_lines_to_queue,
        args=(proc.stderr, "stderr", q),
        daemon=True,
    )
    t_out.start()
    t_err.start()
    timed_out = False
    cancelled = False
    deadline = time.monotonic() + timeout if timeout is not None else None

    try:
        while proc.poll() is None:
            try:
                name, text, eol = q.get(timeout=_CANCEL_POLL_SEC)
            except queue.Empty:
                if should_cancel is not None and should_cancel():
                    cancelled = True
                    proc.kill()
                    break
                if deadline is not None and time.monotonic() >= deadline:
                    timed_out = True
                    proc.kill()
                    break
                continue
            _emit_one_process_output(
                name,
                text,
                eol,
                out_parts,
                err_parts,
                emit,
                node_id=node_id,
                graph_id=graph_id,
                attempt=attempt,
                seq=seq,
            )
    finally:
        try:
            proc.wait(timeout=_STREAM_READER_JOIN_SEC)
        except subprocess.TimeoutExpired:
            proc.kill()
            try:
                proc.wait(timeout=_STREAM_READER_JOIN_SEC)
            except subprocess.TimeoutExpired:
                pass
        t_out.join(timeout=_STREAM_READER_JOIN_SEC)
        t_err.join(timeout=_STREAM_READER_JOIN_SEC)
        _drain_process_output_queue(
            q, out_parts, err_parts, emit, node_id=node_id, graph_id=graph_id, attempt=attempt, seq=seq
        )

    stdout = ("".join(out_parts))[:_STDOUT_CAP]
    stderr = ("".join(err_parts))[:_STDOUT_CAP]
    return (stdout, stderr, timed_out, cancelled)


def _record_task_process_result(
    ctx: dict[str, Any],
    node_id: str,
    *,
    exit_code: int,
    success: bool,
    timed_out: bool,
    stdout: str,
    stderr: str,
    cancelled: bool = False,
) -> None:
    out_map = ctx.setdefault("node_outputs", {})
    entry = out_map.setdefault(node_id, {})
    if isinstance(entry, dict):
        entry["processResult"] = {
            "exitCode": exit_code,
            "success": success,
            "timedOut": timed_out,
            "cancelled": cancelled,
            "stdoutChars": len(stdout),
            "stderrChars": len(stderr),
            "stdout": _truncate_for_process_result_storage(
                stdout, MAX_CHAINED_PROCESS_OUTPUT_TEXT_LEN
            ),
            "stderr": _truncate_for_process_result_storage(
                stderr, MAX_CHAINED_PROCESS_OUTPUT_TEXT_LEN
            ),
        }


def run_task_process(
    *,
    node_id: str,
    graph_id: str,
    data: dict[str, Any],
    ctx: dict[str, Any],
    emit: EmitFn,
    should_cancel: Callable[[], bool] | None = None,
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
    subproc_env = _subprocess_env(data)

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
