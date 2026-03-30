# Copyright GraphCaster. All Rights Reserved.

"""Loop control signals (break/continue)."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class LoopControlAction(Enum):
    CONTINUE = "continue"
    BREAK = "break"
    NONE = "none"


class BreakSignal(Exception):
    def __init__(self, return_value: Any = None):
        self.return_value = return_value
        super().__init__("Loop break signal")


class ContinueSignal(Exception):
    pass


@dataclass
class LoopController:
    loop_id: str = ""
    _break_signaled: bool = field(default=False, init=False)
    _continue_signaled: bool = field(default=False, init=False)
    _break_value: Any = field(default=None, init=False)

    @property
    def should_break(self) -> bool:
        return self._break_signaled

    @property
    def should_continue(self) -> bool:
        return self._continue_signaled

    @property
    def break_value(self) -> Any:
        return self._break_value

    def signal_break(self, return_value: Any = None) -> None:
        self._break_signaled = True
        self._break_value = return_value

    def signal_continue(self) -> None:
        self._continue_signaled = True

    def reset_continue(self) -> None:
        self._continue_signaled = False

    def reset(self) -> None:
        self._break_signaled = False
        self._continue_signaled = False
        self._break_value = None

    def parse_output(self, node_output: dict[str, Any]) -> LoopControlAction:
        control = node_output.get("_control")
        if control == LoopControlAction.BREAK.value:
            self._break_signaled = True
            self._break_value = node_output.get("_break_value")
            return LoopControlAction.BREAK
        if control == LoopControlAction.CONTINUE.value:
            self._continue_signaled = True
            return LoopControlAction.CONTINUE
        return LoopControlAction.NONE

    def create_break_output(self, value: Any = None) -> dict[str, Any]:
        return {"_control": LoopControlAction.BREAK.value, "_break_value": value}

    def create_continue_output(self) -> dict[str, Any]:
        return {"_control": LoopControlAction.CONTINUE.value}
