# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

COORDINATOR_WORKER_LOST_REASON = "coordinator_worker_lost"

_RUN_FINISHED_STATUSES = frozenset({"success", "failed", "cancelled", "partial"})


def _json_run_id_matches(value: object, expected_run_id: str) -> bool:
    if isinstance(value, str):
        return value == expected_run_id
    if isinstance(value, bool) or value is None:
        return False
    if isinstance(value, int):
        return str(value) == expected_run_id
    return False


def new_run_stdout_tracker() -> dict[str, Any]:
    return {"saw_run_finished": False, "root_graph_id": None}


def track_stdout_line_for_worker_terminal(
    line: str,
    *,
    expected_run_id: str,
    tracker: dict[str, Any],
) -> None:
    s = line.strip()
    if not s.startswith("{"):
        return
    try:
        obj = json.loads(s)
    except json.JSONDecodeError:
        return
    if not isinstance(obj, dict):
        return
    if not _json_run_id_matches(obj.get("runId"), expected_run_id):
        return
    if obj.get("type") == "run_started":
        g = obj.get("rootGraphId")
        if isinstance(g, str) and g.strip():
            tracker["root_graph_id"] = g.strip()
        return
    if obj.get("type") == "run_finished":
        st = obj.get("status")
        if isinstance(st, str) and st in _RUN_FINISHED_STATUSES:
            tracker["saw_run_finished"] = True


def should_emit_coordinator_worker_lost(tracker: dict[str, Any]) -> bool:
    return not bool(tracker.get("saw_run_finished"))


def build_coordinator_worker_lost_run_finished_line(
    *,
    run_id: str,
    root_graph_id: str,
    worker_process_exit_code: int,
) -> str:
    finished_at = datetime.now(UTC).isoformat(timespec="milliseconds")
    payload: dict[str, Any] = {
        "type": "run_finished",
        "runId": run_id,
        "rootGraphId": root_graph_id,
        "status": "failed",
        "finishedAt": finished_at,
        "reason": COORDINATOR_WORKER_LOST_REASON,
        "coordinatorWorkerLost": True,
        "workerProcessExitCode": worker_process_exit_code,
    }
    return json.dumps(payload, ensure_ascii=False)
