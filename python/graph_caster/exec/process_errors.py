# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import subprocess
import time
from pathlib import Path
from typing import Any

from graph_caster.cursor_agent_argv import MAX_CHAINED_PROCESS_OUTPUT_TEXT_LEN

_CANCEL_POLL_SEC = 0.25
_CANCEL_GRACEFUL_WAIT_SEC = 2.0
_STREAM_READER_JOIN_SEC = 5.0


def _terminate_process_graceful(
    proc: subprocess.Popen[Any],
    *,
    grace_sec: float = _CANCEL_GRACEFUL_WAIT_SEC,
) -> None:
    """
    SIGTERM / ``terminate`` first, then SIGKILL / ``kill`` if the process is still
    alive after ``grace_sec`` (MVP cancel/stop behavior).
    """
    if proc.poll() is not None:
        return
    try:
        proc.terminate()
    except OSError:
        pass
    deadline = time.monotonic() + max(0.0, grace_sec)
    while proc.poll() is None:
        if time.monotonic() >= deadline:
            break
        time.sleep(min(_CANCEL_POLL_SEC, max(0.0, deadline - time.monotonic())))
    if proc.poll() is not None:
        return
    try:
        proc.kill()
    except OSError:
        pass
    try:
        proc.wait(timeout=_STREAM_READER_JOIN_SEC)
    except subprocess.TimeoutExpired:
        pass


def _truncate_for_process_result_storage(s: str, max_len: int) -> str:
    if len(s) <= max_len:
        return s
    if max_len <= 3:
        return s[:max_len]
    return s[: max_len - 3] + "..."


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
