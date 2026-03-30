# Copyright GraphCaster. All Rights Reserved.

"""Loop and iteration nodes for GraphCaster."""

from .control import (
    BreakSignal,
    ContinueSignal,
    LoopControlAction,
    LoopController,
)
from .for_each import BatchContext, ForEachConfig, ForEachNode, IterationContext
from .progress import LoopFinished, LoopProgress, LoopStarted
from .repeat import RepeatConfig, RepeatContext, RepeatNode
from .while_loop import WhileConfig, WhileContext, WhileNode

__all__ = [
    "ForEachNode",
    "ForEachConfig",
    "IterationContext",
    "BatchContext",
    "LoopProgress",
    "LoopStarted",
    "LoopFinished",
    "WhileNode",
    "WhileConfig",
    "WhileContext",
    "RepeatNode",
    "RepeatConfig",
    "RepeatContext",
    "LoopController",
    "LoopControlAction",
    "BreakSignal",
    "ContinueSignal",
]
