# Copyright GraphCaster. All Rights Reserved.

"""While loop node with condition evaluation."""

from __future__ import annotations

import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import Any

from graph_caster.expression import ExpressionEvaluator

from .progress import LoopProgress


@dataclass
class WhileConfig:
    condition: str
    max_iterations: int = 1000
    do_while: bool = False
    break_on_error: bool = True
    emit_progress_every: int = 1


@dataclass
class WhileContext:
    iteration: int
    state: dict[str, Any]
    condition_result: bool

    @property
    def loop_vars(self) -> dict[str, Any]:
        return {"$iteration": self.iteration, **self.state}


class WhileNode:
    def __init__(self, config: WhileConfig):
        self.config = config
        self.loop_id = f"while-{uuid.uuid4().hex[:8]}"
        self._node_id = ""
        self._eval = ExpressionEvaluator()

    def set_node_id(self, node_id: str) -> None:
        self._node_id = node_id

    def iterate(
        self,
        initial_state: dict[str, Any],
        body_fn: Callable[[], dict[str, Any]],
    ) -> Iterator[WhileContext]:
        state = dict(initial_state)
        iteration = 0
        while iteration < self.config.max_iterations:
            if not self.config.do_while or iteration > 0:
                condition_result = self._evaluate_condition(state, iteration)
                if not condition_result:
                    break
            else:
                condition_result = True
            yield WhileContext(
                iteration=iteration,
                state=state.copy(),
                condition_result=condition_result,
            )
            try:
                state = body_fn()
            except Exception:
                if self.config.break_on_error:
                    raise
            iteration += 1

    def _evaluate_condition(self, state: dict[str, Any], iteration: int) -> bool:
        ctx: dict[str, Any] = {
            "json": dict(state),
            "nodes": {},
            "env": {},
            "item": None,
            "run": {},
            "iteration": iteration,
        }
        try:
            return bool(self._eval.evaluate(self.config.condition, ctx))
        except Exception:
            return False

    def emit_progress(self, ctx: WhileContext) -> LoopProgress:
        return LoopProgress(
            loop_id=self.loop_id,
            node_id=self._node_id,
            current=ctx.iteration + 1,
            total=-1,
        )
