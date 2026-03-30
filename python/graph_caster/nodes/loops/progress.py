# Copyright GraphCaster. All Rights Reserved.

"""Loop progress event generation."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


@dataclass
class LoopProgress:
    loop_id: str
    node_id: str
    current: int
    total: int
    item: Any = None
    batch_index: int | None = None
    timestamp: str = ""

    def __post_init__(self) -> None:
        if not self.timestamp:
            self.timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    @property
    def percent(self) -> float:
        if self.total <= 0:
            return 100.0
        return (self.current / self.total) * 100

    @property
    def remaining(self) -> int:
        return max(0, self.total - self.current)

    def to_event(self) -> dict[str, Any]:
        return {
            "type": "loop_progress",
            "loopId": self.loop_id,
            "nodeId": self.node_id,
            "current": self.current,
            "total": self.total,
            "percent": round(self.percent, 1),
            "remaining": self.remaining,
            "timestamp": self.timestamp,
        }


@dataclass
class LoopStarted:
    loop_id: str
    node_id: str
    total: int
    batch_size: int | None = None
    timestamp: str = ""

    def __post_init__(self) -> None:
        if not self.timestamp:
            self.timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    def to_event(self) -> dict[str, Any]:
        return {
            "type": "loop_started",
            "loopId": self.loop_id,
            "nodeId": self.node_id,
            "total": self.total,
            "batchSize": self.batch_size,
            "timestamp": self.timestamp,
        }


@dataclass
class LoopFinished:
    loop_id: str
    node_id: str
    iterations_completed: int
    was_broken: bool = False
    error: str | None = None
    timestamp: str = ""

    def __post_init__(self) -> None:
        if not self.timestamp:
            self.timestamp = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    def to_event(self) -> dict[str, Any]:
        return {
            "type": "loop_finished",
            "loopId": self.loop_id,
            "nodeId": self.node_id,
            "iterationsCompleted": self.iterations_completed,
            "wasBroken": self.was_broken,
            "error": self.error,
            "timestamp": self.timestamp,
        }
