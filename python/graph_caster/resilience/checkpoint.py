# Copyright GraphCaster. All Rights Reserved.

"""Checkpoint storage for run state persistence."""

from __future__ import annotations

import json
import sqlite3
import threading
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


class CheckpointNotFoundError(Exception):
    """Raised when checkpoint doesn't exist."""

    def __init__(self, run_id: str):
        self.run_id = run_id
        super().__init__(f"Checkpoint not found: {run_id}")


@dataclass
class RunCheckpoint:
    """Snapshot of run state for recovery."""

    run_id: str
    graph_id: str
    current_node_id: str
    node_outputs: dict[str, Any]
    status: str
    started_at: str
    last_event_index: int = 0
    error_message: str | None = None
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> RunCheckpoint:
        return cls(
            run_id=str(data["run_id"]),
            graph_id=str(data["graph_id"]),
            current_node_id=str(data["current_node_id"]),
            node_outputs=dict(data.get("node_outputs") or {}),
            status=str(data["status"]),
            started_at=str(data["started_at"]),
            last_event_index=int(data.get("last_event_index") or 0),
            error_message=data.get("error_message"),
            updated_at=str(data.get("updated_at") or datetime.now(timezone.utc).isoformat()),
        )


class CheckpointStore:
    """SQLite-backed checkpoint storage with atomic writes."""

    def __init__(self, db_path: Path | str):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._local = threading.local()
        self._init_schema()

    def _get_conn(self) -> sqlite3.Connection:
        if not hasattr(self._local, "conn") or self._local.conn is None:
            self._local.conn = sqlite3.connect(
                str(self.db_path),
                timeout=30.0,
                isolation_level="IMMEDIATE",
                check_same_thread=False,
            )
            self._local.conn.row_factory = sqlite3.Row
        return self._local.conn

    def close(self) -> None:
        """Close the thread-local connection if open (tests / shutdown)."""
        conn = getattr(self._local, "conn", None)
        if conn is not None:
            try:
                conn.close()
            finally:
                self._local.conn = None

    def _init_schema(self) -> None:
        conn = self._get_conn()
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS checkpoints (
                run_id TEXT PRIMARY KEY,
                data TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_checkpoints_updated
            ON checkpoints(updated_at)
            """
        )
        conn.commit()

    def save(self, checkpoint: RunCheckpoint) -> None:
        checkpoint.updated_at = datetime.now(timezone.utc).isoformat()
        data = json.dumps(checkpoint.to_dict())
        conn = self._get_conn()
        conn.execute(
            "REPLACE INTO checkpoints (run_id, data, updated_at) VALUES (?, ?, ?)",
            (checkpoint.run_id, data, checkpoint.updated_at),
        )
        conn.commit()

    def load(self, run_id: str) -> RunCheckpoint:
        conn = self._get_conn()
        row = conn.execute(
            "SELECT data FROM checkpoints WHERE run_id = ?",
            (run_id,),
        ).fetchone()
        if row is None:
            raise CheckpointNotFoundError(run_id)
        return RunCheckpoint.from_dict(json.loads(row["data"]))

    def delete(self, run_id: str) -> None:
        conn = self._get_conn()
        conn.execute("DELETE FROM checkpoints WHERE run_id = ?", (run_id,))
        conn.commit()

    def list_active(self) -> list[RunCheckpoint]:
        conn = self._get_conn()
        rows = conn.execute(
            "SELECT data FROM checkpoints WHERE json_extract(data, '$.status') = 'running'"
        ).fetchall()
        return [RunCheckpoint.from_dict(json.loads(r["data"])) for r in rows]

    def list_all(self) -> list[RunCheckpoint]:
        conn = self._get_conn()
        rows = conn.execute("SELECT data FROM checkpoints").fetchall()
        return [RunCheckpoint.from_dict(json.loads(r["data"])) for r in rows]

    def cleanup_old(self, before: str) -> int:
        conn = self._get_conn()
        cur = conn.execute(
            "DELETE FROM checkpoints WHERE updated_at < ?",
            (before,),
        )
        conn.commit()
        return int(cur.rowcount or 0)
