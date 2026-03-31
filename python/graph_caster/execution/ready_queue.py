# Copyright GraphCaster. All Rights Reserved.

"""Roadmap **ReadyQueue** name for single-threaded runnable scheduling.

The in-process runner uses :class:`~graph_caster.step_queue.StepQueue` with
:class:`~graph_caster.step_queue.ExecutionFrame`. This module re-exports them so
plans and tooling can reference ``execution.ready_queue`` without duplicating
the deque implementation.
"""

from __future__ import annotations

from graph_caster.step_queue import ExecutionFrame, StepQueue

ReadyQueue = StepQueue

__all__ = ["ExecutionFrame", "ReadyQueue"]
