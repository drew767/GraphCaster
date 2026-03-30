# Copyright GraphCaster. All Rights Reserved.

"""Parallel execution engine for GraphCaster."""

from .context import BranchContext
from .executor import ExecutionResult, ExecutorConfig, ParallelExecutor
from .fork import BranchSpec, ForkNode, ForkStrategy
from .limits import (
    AcquisitionToken,
    ConcurrencyLimiter,
    LimitExceededError,
    ResourceLimits,
)
from .merge import BranchResult, MergeNode, MergeResult, MergeStrategy

__all__ = [
    "ParallelExecutor",
    "ExecutorConfig",
    "ExecutionResult",
    "ForkNode",
    "ForkStrategy",
    "BranchSpec",
    "MergeNode",
    "MergeStrategy",
    "BranchResult",
    "MergeResult",
    "BranchContext",
    "ConcurrencyLimiter",
    "ResourceLimits",
    "LimitExceededError",
    "AcquisitionToken",
]
