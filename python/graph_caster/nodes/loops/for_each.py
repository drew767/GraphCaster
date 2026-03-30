# Copyright GraphCaster. All Rights Reserved.

"""For-each iteration node."""

from __future__ import annotations

import uuid
from collections.abc import Iterator, Sequence
from dataclasses import dataclass
from typing import Any

from .progress import LoopFinished, LoopProgress, LoopStarted


@dataclass
class ForEachConfig:
    input_key: str = "items"
    output_key: str = "item"
    batch_size: int | None = None
    iterate_mode: str = "values"
    continue_on_error: bool = False


@dataclass
class IterationContext:
    item: Any
    index: int
    total: int
    is_first: bool
    is_last: bool
    batch_items: list[Any] | None = None

    @property
    def loop_vars(self) -> dict[str, Any]:
        return {
            "$item": self.item,
            "$index": self.index,
            "$total": self.total,
            "$isFirst": self.is_first,
            "$isLast": self.is_last,
        }


@dataclass
class BatchContext:
    items: list[Any]
    batch_index: int
    batch_count: int
    start_index: int


class ForEachNode:
    def __init__(self, config: ForEachConfig | None = None):
        self.config = config or ForEachConfig()
        self.loop_id = f"loop-{uuid.uuid4().hex[:8]}"
        self._node_id = ""

    def set_node_id(self, node_id: str) -> None:
        self._node_id = node_id

    def iterate(self, input_data: dict[str, Any]) -> Iterator[IterationContext]:
        items = self._get_items(input_data)
        total = len(items)
        for index, item in enumerate(items):
            yield IterationContext(
                item=item,
                index=index,
                total=total,
                is_first=index == 0,
                is_last=index == total - 1,
            )

    def iterate_batches(self, input_data: dict[str, Any]) -> Iterator[BatchContext]:
        items = list(self._get_items(input_data))
        batch_size = self.config.batch_size or len(items)
        if batch_size <= 0:
            batch_size = len(items) or 1
        batch_count = (len(items) + batch_size - 1) // batch_size
        for batch_index in range(batch_count):
            start = batch_index * batch_size
            end = min(start + batch_size, len(items))
            yield BatchContext(
                items=list(items[start:end]),
                batch_index=batch_index,
                batch_count=batch_count,
                start_index=start,
            )

    def emit_progress(self, ctx: IterationContext) -> LoopProgress:
        return LoopProgress(
            loop_id=self.loop_id,
            node_id=self._node_id,
            current=ctx.index + 1,
            total=ctx.total,
            item=ctx.item if not isinstance(ctx.item, (dict, list)) else None,
        )

    def emit_started(self, total: int) -> LoopStarted:
        return LoopStarted(
            loop_id=self.loop_id,
            node_id=self._node_id,
            total=total,
            batch_size=self.config.batch_size,
        )

    def emit_finished(
        self,
        iterations: int,
        was_broken: bool = False,
        error: str | None = None,
    ) -> LoopFinished:
        return LoopFinished(
            loop_id=self.loop_id,
            node_id=self._node_id,
            iterations_completed=iterations,
            was_broken=was_broken,
            error=error,
        )

    def _get_items(self, input_data: dict[str, Any]) -> Sequence[Any]:
        if self.config.input_key not in input_data:
            raise KeyError(self.config.input_key)
        raw = input_data[self.config.input_key]
        if isinstance(raw, dict):
            if self.config.iterate_mode == "entries":
                return list(raw.items())
            if self.config.iterate_mode == "keys":
                return list(raw.keys())
            return list(raw.values())
        if isinstance(raw, (list, tuple)):
            return raw
        return [raw]
