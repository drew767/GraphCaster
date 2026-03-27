# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class RunHostContext:
    """Infrastructure paths: graph index root for ``graph_ref`` and workspace root for ``runs/``."""
    graphs_root: Path | None = None
    artifacts_base: Path | None = None

    def __post_init__(self) -> None:
        gr = Path(self.graphs_root).resolve() if self.graphs_root is not None else None
        ab = Path(self.artifacts_base).resolve() if self.artifacts_base is not None else None
        object.__setattr__(self, "graphs_root", gr)
        object.__setattr__(self, "artifacts_base", ab)
