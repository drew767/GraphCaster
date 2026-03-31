# Copyright GraphCaster. All Rights Reserved.

"""Simple in-process counters for run diagnostics."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class RunCounters:
    """Mutable counters (optional export to OTEL later)."""

    nodes_entered: int = 0
    nodes_exited: int = 0
    branches_forked: int = 0
    extra: dict[str, int] = field(default_factory=dict)

    def bump(self, name: str, delta: int = 1) -> None:
        self.extra[name] = self.extra.get(name, 0) + delta
