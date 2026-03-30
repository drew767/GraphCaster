# Copyright GraphCaster. All Rights Reserved.

"""NDJSON event log reader."""

from __future__ import annotations

import json
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any


class EventType(Enum):
    RUN_STARTED = "run_started"
    RUN_FINISHED = "run_finished"
    STEP_STARTED = "step_started"
    STEP_FINISHED = "step_finished"
    CONSOLE = "console"
    ARTIFACT = "artifact"
    VARIABLE = "variable"
    ERROR = "error"
    RECOVERY = "recovery_started"
    PING = "ping"


@dataclass
class RunEvent:
    type: EventType
    run_id: str
    timestamp: datetime
    data: dict[str, Any]
    index: int = 0

    @classmethod
    def from_dict(cls, data: dict[str, Any], index: int = 0) -> RunEvent:
        type_str = str(data.get("type", ""))
        try:
            event_type = EventType(type_str)
        except ValueError:
            event_type = EventType.CONSOLE
        timestamp_str = str(data.get("timestamp", ""))
        try:
            timestamp = datetime.fromisoformat(timestamp_str.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            timestamp = datetime.now(timezone.utc)
        return cls(
            type=event_type,
            run_id=str(data.get("runId", "")),
            timestamp=timestamp,
            data=data,
            index=index,
        )


class EventLogReader:
    def __init__(self, log_path: Path | str):
        self.log_path = Path(log_path)
        self._line_offsets: list[int] | None = None
        self._line_count: int | None = None

    def _ensure_indexed(self) -> None:
        if self._line_offsets is not None:
            return
        self._line_offsets = []
        offset = 0
        with self.log_path.open("rb") as f:
            for line in f:
                self._line_offsets.append(offset)
                offset += len(line)
        self._line_count = len(self._line_offsets)

    def count(self) -> int:
        self._ensure_indexed()
        return int(self._line_count or 0)

    def read_all(self) -> Iterator[RunEvent]:
        with self.log_path.open("r", encoding="utf-8") as f:
            for index, line in enumerate(f):
                line = line.strip()
                if not line:
                    continue
                try:
                    data = json.loads(line)
                    if not isinstance(data, dict):
                        continue
                    yield RunEvent.from_dict(data, index)
                except json.JSONDecodeError:
                    continue

    def read_by_type(self, types: Sequence[EventType]) -> Iterator[RunEvent]:
        type_values = {t.value for t in types}
        for event in self.read_all():
            if event.type.value in type_values:
                yield event

    def read_by_node(self, node_id: str) -> Iterator[RunEvent]:
        for event in self.read_all():
            if event.data.get("nodeId") == node_id:
                yield event

    def read_range(self, start: int, end: int) -> Iterator[RunEvent]:
        self._ensure_indexed()
        if not self._line_offsets:
            return
        end = min(end, len(self._line_offsets))
        with self.log_path.open("rb") as f:
            for index in range(start, end):
                f.seek(self._line_offsets[index])
                line = f.readline().decode("utf-8").strip()
                if line:
                    try:
                        data = json.loads(line)
                        if isinstance(data, dict):
                            yield RunEvent.from_dict(data, index)
                    except json.JSONDecodeError:
                        continue

    def get(self, index: int) -> RunEvent | None:
        events = list(self.read_range(index, index + 1))
        return events[0] if events else None

    def search(self, query: str) -> Iterator[RunEvent]:
        q = query.lower()
        for event in self.read_all():
            if q in json.dumps(event.data).lower():
                yield event
