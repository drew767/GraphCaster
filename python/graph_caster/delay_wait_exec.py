# Copyright GraphCaster. All Rights Reserved.

"""Fixed delay, debounce (same sleep semantics), and wait-for-file helpers for timer nodes."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any, Callable

EmitFn = Callable[..., None]
CancelFn = Callable[[], bool] | None

_MAX_DURATION_SEC = 86400.0
_MIN_POLL_SEC = 0.05
_MAX_POLL_SEC = 10.0


def redact_timer_node_data_for_execute(data: dict[str, Any]) -> dict[str, Any]:
    """Strip nothing sensitive; return a shallow copy for node_execute events."""
    return dict(data)


def parse_duration_sec(data: dict[str, Any]) -> float | None:
    """Parse ``durationSec`` for ``delay`` / ``debounce`` nodes; strictly positive, capped."""
    raw = data.get("durationSec")
    if raw is None:
        return None
    try:
        sec = float(raw)
    except (TypeError, ValueError):
        return None
    if sec <= 0 or sec != sec:  # NaN
        return None
    return float(min(_MAX_DURATION_SEC, max(sec, 0.0)))


def parse_wait_for_file_params(data: dict[str, Any]) -> tuple[float, float] | None:
    """Return (timeout_sec, poll_sec) or None if invalid."""
    raw_t = data.get("timeoutSec")
    try:
        timeout = float(raw_t) if raw_t is not None else 300.0
    except (TypeError, ValueError):
        return None
    if timeout <= 0:
        return None
    timeout = min(_MAX_DURATION_SEC, timeout)

    raw_p = data.get("pollIntervalSec")
    try:
        poll = float(raw_p) if raw_p is not None else 0.25
    except (TypeError, ValueError):
        return None
    poll = min(_MAX_POLL_SEC, max(_MIN_POLL_SEC, poll))
    return timeout, poll


def resolve_wait_file_path(workspace_root: Path | None, rel: str) -> tuple[Path | None, str | None]:
    """
    Resolve a workspace-relative path. Returns (absolute Path, None) or (None, error_code).
    """
    if workspace_root is None:
        return None, "wait_for_no_workspace"
    r = rel.strip()
    if not r:
        return None, "wait_for_empty_path"
    root = workspace_root.resolve()
    try:
        combined = (root / r).resolve()
    except OSError:
        return None, "wait_for_bad_path"
    try:
        combined.relative_to(root)
    except ValueError:
        return None, "wait_for_path_escape"
    return combined, None


def interruptible_sleep(
    total_sec: float,
    *,
    should_cancel: CancelFn,
    slice_sec: float = 0.2,
) -> bool:
    """
    Sleep up to ``total_sec`` seconds in small slices. Returns False if cancelled.
    """
    if total_sec <= 0:
        return True
    deadline = time.monotonic() + total_sec
    sl = max(0.01, min(slice_sec, 0.5))
    while time.monotonic() < deadline:
        if should_cancel is not None and should_cancel():
            return False
        remain = deadline - time.monotonic()
        if remain <= 0:
            break
        time.sleep(min(sl, remain))
    return not (should_cancel is not None and should_cancel())


def execute_delay_or_debounce(
    *,
    node_id: str,
    graph_id: str,
    wait_kind: str,
    data: dict[str, Any],
    emit: EmitFn,
    should_cancel: CancelFn = None,
) -> tuple[bool, dict[str, Any]]:
    """Fixed sleep for ``delay`` or ``debounce`` (same behavior, different ``wait_kind`` for events)."""
    sec = parse_duration_sec(data)
    if sec is None:
        err = "delay_invalid_duration"
        emit(
            "wait_timer",
            nodeId=node_id,
            graphId=graph_id,
            phase="complete",
            waitKind=wait_kind,
            durationSec=0.0,
            success=False,
            error=err,
        )
        return False, {
            "processResult": {"success": False, "exitCode": 0, "timedOut": False, "error": err},
            "waitResult": {"success": False, "kind": wait_kind, "error": err},
        }

    emit(
        "wait_timer",
        nodeId=node_id,
        graphId=graph_id,
        phase="start",
        waitKind=wait_kind,
        durationSec=sec,
    )
    ok_sleep = interruptible_sleep(sec, should_cancel=should_cancel)
    if not ok_sleep:
        emit(
            "wait_timer",
            nodeId=node_id,
            graphId=graph_id,
            phase="cancelled",
            waitKind=wait_kind,
            durationSec=sec,
        )
        err = "cancelled"
        return False, {
            "processResult": {
                "success": False,
                "exitCode": 0,
                "timedOut": False,
                "cancelled": True,
                "error": err,
            },
            "waitResult": {"success": False, "kind": wait_kind, "error": err},
        }

    emit(
        "wait_timer",
        nodeId=node_id,
        graphId=graph_id,
        phase="complete",
        waitKind=wait_kind,
        durationSec=sec,
        success=True,
    )
    return True, {
        "processResult": {"success": True, "exitCode": 0, "timedOut": False},
        "waitResult": {"success": True, "kind": wait_kind, "durationSec": sec},
    }


def execute_wait_for_file(
    *,
    node_id: str,
    graph_id: str,
    data: dict[str, Any],
    workspace_root: Path | None,
    emit: EmitFn,
    should_cancel: CancelFn = None,
) -> tuple[bool, dict[str, Any]]:
    mode = str(data.get("waitMode") or "file").strip().lower()
    if mode != "file":
        err = "wait_for_unknown_mode"
        return False, {
            "processResult": {"success": False, "exitCode": 0, "timedOut": False, "error": err},
            "waitResult": {"success": False, "error": err},
        }

    path_raw = data.get("path")
    if not isinstance(path_raw, str):
        err = "wait_for_empty_path"
        return False, {
            "processResult": {"success": False, "exitCode": 0, "timedOut": False, "error": err},
            "waitResult": {"success": False, "error": err},
        }

    params = parse_wait_for_file_params(data)
    if params is None:
        err = "wait_for_invalid_timeout"
        return False, {
            "processResult": {"success": False, "exitCode": 0, "timedOut": False, "error": err},
            "waitResult": {"success": False, "error": err},
        }
    timeout_sec, poll_sec = params

    abs_path, res_err = resolve_wait_file_path(workspace_root, path_raw)
    if abs_path is None or res_err:
        err = res_err or "wait_for_bad_path"
        return False, {
            "processResult": {"success": False, "exitCode": 0, "timedOut": False, "error": err},
            "waitResult": {"success": False, "error": err},
        }

    emit(
        "wait_timer",
        nodeId=node_id,
        graphId=graph_id,
        phase="start",
        waitKind="wait_file",
        path=str(path_raw).strip(),
        timeoutSec=timeout_sec,
    )
    deadline = time.monotonic() + timeout_sec
    while time.monotonic() < deadline:
        if should_cancel is not None and should_cancel():
            emit(
                "wait_timer",
                nodeId=node_id,
                graphId=graph_id,
                phase="cancelled",
                waitKind="wait_file",
                path=str(path_raw).strip(),
            )
            err = "cancelled"
            return False, {
                "processResult": {
                    "success": False,
                    "exitCode": 0,
                    "timedOut": False,
                    "cancelled": True,
                    "error": err,
                },
                "waitResult": {"success": False, "kind": "wait_file", "error": err},
            }
        try:
            if abs_path.exists():
                waited = timeout_sec - max(0.0, deadline - time.monotonic())
                emit(
                    "wait_timer",
                    nodeId=node_id,
                    graphId=graph_id,
                    phase="complete",
                    waitKind="wait_file",
                    path=str(path_raw).strip(),
                    success=True,
                    waitedSec=round(waited, 3),
                )
                return True, {
                    "processResult": {"success": True, "exitCode": 0, "timedOut": False},
                    "waitResult": {
                        "success": True,
                        "kind": "wait_file",
                        "path": str(path_raw).strip(),
                    },
                }
        except OSError:
            pass
        slice_rem = min(poll_sec, max(0.0, deadline - time.monotonic()))
        if slice_rem > 0:
            time.sleep(slice_rem)

    emit(
        "wait_timer",
        nodeId=node_id,
        graphId=graph_id,
        phase="timeout",
        waitKind="wait_file",
        path=str(path_raw).strip(),
        timeoutSec=timeout_sec,
    )
    err = "wait_file_timeout"
    return False, {
        "processResult": {"success": False, "exitCode": 0, "timedOut": True, "error": err},
        "waitResult": {"success": False, "kind": "wait_file", "error": err, "path": str(path_raw).strip()},
    }
