# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class RunHostContext:
    """Paths for ``graph_ref`` (``graphs_root``), optional workspace secrets file (``workspace_root``), and artifact runs (``artifacts_base``)."""
    graphs_root: Path | None = None
    artifacts_base: Path | None = None
    workspace_root: Path | None = None

    def __post_init__(self) -> None:
        gr = Path(self.graphs_root).resolve() if self.graphs_root is not None else None
        ab = Path(self.artifacts_base).resolve() if self.artifacts_base is not None else None
        wr = Path(self.workspace_root).resolve() if self.workspace_root is not None else None
        object.__setattr__(self, "graphs_root", gr)
        object.__setattr__(self, "artifacts_base", ab)
        object.__setattr__(self, "workspace_root", wr)

    def resolved_workspace_root(self) -> Path | None:
        if self.workspace_root is not None:
            return self.workspace_root
        if self.graphs_root is not None:
            return self.graphs_root.parent
        return None
