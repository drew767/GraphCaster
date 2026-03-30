# Copyright GraphCaster. All Rights Reserved.

"""Synthetic event generation for crash recovery."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any


class SyntheticEventReason(Enum):
    WORKER_CRASH = "Worker process crashed unexpectedly"
    WATCHDOG_TIMEOUT = "Watchdog detected worker timeout"
    TIMEOUT = "Node execution timed out"
    NETWORK_ERROR = "Network connection lost"
    SHUTDOWN = "System shutdown requested"
    RECOVERY = "Recovered from previous crash"


def generate_synthetic_finish(
    run_id: str,
    reason: SyntheticEventReason,
    last_node_id: str | None = None,
    extra_data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    event: dict[str, Any] = {
        "type": "run_finished",
        "runId": run_id,
        "ok": False,
        "synthetic": True,
        "syntheticReason": reason.name,
        "errorMessage": f"{reason.name}: {reason.value}",
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    if last_node_id:
        event["lastNodeId"] = last_node_id
    if extra_data:
        event.update(extra_data)
    return event


def generate_synthetic_node_finish(
    run_id: str,
    node_id: str,
    reason: SyntheticEventReason,
    error_message: str | None = None,
    extra_data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    event: dict[str, Any] = {
        "type": "step_finished",
        "runId": run_id,
        "nodeId": node_id,
        "ok": False,
        "synthetic": True,
        "syntheticReason": reason.name,
        "errorMessage": error_message or f"Node execution terminated: {reason.value}",
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    if extra_data:
        event.update(extra_data)
    return event


def generate_recovery_started(
    run_id: str,
    from_checkpoint: bool,
    checkpoint_node_id: str | None = None,
) -> dict[str, Any]:
    return {
        "type": "recovery_started",
        "runId": run_id,
        "fromCheckpoint": from_checkpoint,
        "checkpointNodeId": checkpoint_node_id,
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


def generate_stream_backpressure(run_id: str, paused: bool, queue_size: int) -> dict[str, Any]:
    return {
        "type": "stream_backpressure",
        "runId": run_id,
        "paused": paused,
        "queueSize": queue_size,
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
