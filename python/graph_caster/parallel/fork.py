# Copyright GraphCaster. All Rights Reserved.

"""Fork node for parallel branch creation."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from enum import Enum
from typing import Any

from .context import BranchContext


class ForkStrategy(Enum):
    PARALLEL = "parallel"
    SEQUENTIAL = "sequential"
    RACE = "race"


@dataclass
class BranchSpec:
    branch_id: str
    port: str
    context: BranchContext
    condition: str | None = None
    sequential: bool = False
    priority: int = 0

    @property
    def should_run(self) -> bool:
        return True


@dataclass
class ForkNode:
    strategy: ForkStrategy = ForkStrategy.PARALLEL
    max_parallel: int | None = None

    def create_branches(
        self,
        output_ports: list[str],
        input_data: dict[str, Any],
        parent_context: BranchContext | None = None,
        conditions: dict[str, str] | None = None,
    ) -> list[BranchSpec]:
        conditions = conditions or {}
        branches: list[BranchSpec] = []
        if parent_context is None:
            parent_context = BranchContext(run_id=f"run-{uuid.uuid4().hex[:8]}")
        for i, port in enumerate(output_ports):
            branch_id = f"{parent_context.branch_id or 'root'}/{port}"
            branch_context = parent_context.fork(branch_id)
            branch_context.variables["_fork_input"] = input_data
            branches.append(
                BranchSpec(
                    branch_id=branch_id,
                    port=port,
                    context=branch_context,
                    condition=conditions.get(port),
                    sequential=self.strategy == ForkStrategy.SEQUENTIAL,
                    priority=i,
                )
            )
        return branches

    def get_execution_plan(self, branches: list[BranchSpec]) -> list[list[BranchSpec]]:
        if self.strategy == ForkStrategy.SEQUENTIAL:
            return [[b] for b in branches]
        if self.max_parallel is None:
            return [branches]
        batches: list[list[BranchSpec]] = []
        current: list[BranchSpec] = []
        for branch in branches:
            current.append(branch)
            if len(current) >= self.max_parallel:
                batches.append(current)
                current = []
        if current:
            batches.append(current)
        return batches
