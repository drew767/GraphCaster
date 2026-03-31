# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class RunJob:
    """Serializable job payload for `RunQueueService` / RQ."""

    job_id: str
    graph_id: str
    run_id: str
    graphs_dir: str
    context: dict[str, Any] = field(default_factory=dict)
    artifacts_base: str | None = None
    workspace_root: str | None = None
    priority: int = 0
    attempts: int = 0
    max_attempts: int = 3

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> RunJob:
        return cls(
            job_id=str(raw["job_id"]),
            graph_id=str(raw["graph_id"]),
            run_id=str(raw["run_id"]),
            graphs_dir=str(raw["graphs_dir"]),
            context=dict(raw.get("context") or {}),
            artifacts_base=raw.get("artifacts_base"),
            workspace_root=raw.get("workspace_root"),
            priority=int(raw.get("priority") or 0),
            attempts=int(raw.get("attempts") or 0),
            max_attempts=int(raw.get("max_attempts") or 3),
        )
