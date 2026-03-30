# Copyright GraphCaster. All Rights Reserved.

"""Context isolation for parallel branches."""

from __future__ import annotations

import copy
from dataclasses import dataclass, field
from typing import Any


@dataclass
class BranchContext:
    run_id: str
    branch_id: str = ""
    parent_branch_id: str | None = None
    node_outputs: dict[str, Any] = field(default_factory=dict)
    variables: dict[str, Any] = field(default_factory=dict)
    env: dict[str, str] = field(default_factory=dict)
    depth: int = 0

    def fork(self, branch_id: str) -> BranchContext:
        return BranchContext(
            run_id=self.run_id,
            branch_id=branch_id,
            parent_branch_id=self.branch_id or None,
            node_outputs=copy.deepcopy(self.node_outputs),
            variables=copy.deepcopy(self.variables),
            env=dict(self.env),
            depth=self.depth + 1,
        )

    def merge_outputs(self, child: BranchContext) -> None:
        for node_id, output in child.node_outputs.items():
            if node_id not in self.node_outputs:
                self.node_outputs[node_id] = copy.deepcopy(output)
