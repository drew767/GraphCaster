# Copyright GraphCaster. All Rights Reserved.

"""Fixed-count repeat node."""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

from .progress import LoopProgress


@dataclass
class RepeatConfig:
    count: int = 1
    count_expression: str | None = None


@dataclass
class RepeatContext:
    iteration: int
    total: int
    is_first: bool
    is_last: bool

    @property
    def remaining(self) -> int:
        return self.total - self.iteration - 1

    @property
    def loop_vars(self) -> dict[str, Any]:
        return {
            "$iteration": self.iteration,
            "$total": self.total,
            "$isFirst": self.is_first,
            "$isLast": self.is_last,
            "$remaining": self.remaining,
        }


class RepeatNode:
    def __init__(self, config: RepeatConfig):
        self.config = config
        self.loop_id = f"repeat-{uuid.uuid4().hex[:8]}"
        self._node_id = ""

    def set_node_id(self, node_id: str) -> None:
        self._node_id = node_id

    def iterate(self, input_data: dict[str, Any]) -> Iterator[RepeatContext]:
        count = self._get_count(input_data)
        for i in range(count):
            yield RepeatContext(
                iteration=i,
                total=count,
                is_first=i == 0,
                is_last=i == count - 1,
            )

    def _get_count(self, input_data: dict[str, Any]) -> int:
        if self.config.count_expression:
            expr = self.config.count_expression
            if expr.startswith("$json."):
                key = expr[6:]
                if key in input_data:
                    return int(input_data[key])
                nested = input_data.get("json")
                if isinstance(nested, dict) and key in nested:
                    return int(nested[key])
                return int(input_data.get(key, 0))
            return 0
        return max(0, int(self.config.count))

    def emit_progress(self, ctx: RepeatContext) -> LoopProgress:
        return LoopProgress(
            loop_id=self.loop_id,
            node_id=self._node_id,
            current=ctx.iteration + 1,
            total=ctx.total,
        )
