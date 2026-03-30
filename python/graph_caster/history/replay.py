# Copyright GraphCaster. All Rights Reserved.

"""Event replay for history viewing."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any

from .events import EventLogReader, EventType, RunEvent


class ReplayMode(Enum):
    PAUSED = "paused"
    PLAYING = "playing"
    FINISHED = "finished"


@dataclass
class ReplayState:
    current_index: int
    current_event: RunEvent | None
    node_states: dict[str, str]
    node_outputs: dict[str, Any]
    total_events: int
    mode: ReplayMode = ReplayMode.PAUSED


@dataclass
class StateDiff:
    from_index: int
    to_index: int
    added_nodes: list[str]
    removed_nodes: list[str]
    changed_states: dict[str, tuple[str, str]]
    changed_outputs: dict[str, Any]


class EventReplayer:
    def __init__(self, log_path: Path | str):
        self.reader = EventLogReader(log_path)
        self._events: list[RunEvent] = list(self.reader.read_all())
        self._current_index: int = -1
        self._node_states: dict[str, str] = {}
        self._node_outputs: dict[str, Any] = {}

    @property
    def total_events(self) -> int:
        return len(self._events)

    def reset(self) -> ReplayState:
        self._current_index = -1
        self._node_states.clear()
        self._node_outputs.clear()
        return self._get_state()

    def step_forward(self) -> ReplayState:
        if self._current_index >= len(self._events) - 1:
            return self._get_state()
        self._current_index += 1
        self._apply_event(self._events[self._current_index])
        return self._get_state()

    def step_backward(self) -> ReplayState:
        if self._current_index <= 0:
            return self.reset()
        target = self._current_index - 1
        return self.go_to(target)

    def go_to(self, index: int) -> ReplayState:
        if index < 0:
            return self.reset()
        index = min(index, len(self._events) - 1)
        self._node_states.clear()
        self._node_outputs.clear()
        for i in range(index + 1):
            self._apply_event(self._events[i])
        self._current_index = index
        return self._get_state()

    def get_node_output(self, node_id: str) -> Any:
        return self._node_outputs.get(node_id)

    def get_diff(self, from_index: int, to_index: int) -> StateDiff:
        self.go_to(from_index)
        from_states = dict(self._node_states)
        from_outputs = dict(self._node_outputs)
        self.go_to(to_index)
        to_states = dict(self._node_states)
        to_outputs = dict(self._node_outputs)
        added_nodes = [n for n in to_states if n not in from_states]
        removed_nodes = [n for n in from_states if n not in to_states]
        changed_states: dict[str, tuple[str, str]] = {}
        for node_id in set(from_states) & set(to_states):
            if from_states[node_id] != to_states[node_id]:
                changed_states[node_id] = (from_states[node_id], to_states[node_id])
        changed_outputs: dict[str, Any] = {}
        for node_id in to_outputs:
            if node_id not in from_outputs or from_outputs[node_id] != to_outputs[node_id]:
                changed_outputs[node_id] = to_outputs[node_id]
        return StateDiff(
            from_index=from_index,
            to_index=to_index,
            added_nodes=added_nodes,
            removed_nodes=removed_nodes,
            changed_states=changed_states,
            changed_outputs=changed_outputs,
        )

    def _apply_event(self, event: RunEvent) -> None:
        event_type = event.type
        node_id = event.data.get("nodeId")
        if event_type == EventType.STEP_STARTED and isinstance(node_id, str):
            self._node_states[node_id] = "running"
        elif event_type == EventType.STEP_FINISHED and isinstance(node_id, str):
            ok = bool(event.data.get("ok", True))
            self._node_states[node_id] = "completed" if ok else "failed"
            output = event.data.get("output")
            if output is not None:
                self._node_outputs[node_id] = output

    def _get_state(self) -> ReplayState:
        current_event: RunEvent | None = None
        if 0 <= self._current_index < len(self._events):
            current_event = self._events[self._current_index]
        mode = ReplayMode.FINISHED if self._current_index >= len(self._events) - 1 else ReplayMode.PAUSED
        return ReplayState(
            current_index=self._current_index,
            current_event=current_event,
            node_states=dict(self._node_states),
            node_outputs=dict(self._node_outputs),
            total_events=len(self._events),
            mode=mode,
        )
