# Copyright GraphCaster. All Rights Reserved.

"""SQLite catalog for run metadata."""

from __future__ import annotations

import sqlite3
import threading
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Any


class RunStatus(Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class RunRecord:
    run_id: str
    graph_id: str
    graph_name: str
    status: RunStatus
    started_at: datetime
    finished_at: datetime | None = None
    node_count: int = 0
    event_count: int = 0
    error_message: str | None = None
    artifact_dir: str | None = None
    trigger: str = "manual"

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> RunRecord:
        return cls(
            run_id=str(row["run_id"]),
            graph_id=str(row["graph_id"]),
            graph_name=str(row["graph_name"]),
            status=RunStatus(str(row["status"])),
            started_at=datetime.fromisoformat(str(row["started_at"])),
            finished_at=datetime.fromisoformat(str(row["finished_at"]))
            if row["finished_at"]
            else None,
            node_count=int(row["node_count"] or 0),
            event_count=int(row["event_count"] or 0),
            error_message=row["error_message"],
            artifact_dir=row["artifact_dir"],
            trigger=str(row["trigger"] or "manual"),
        )


@dataclass
class RunFilter:
    graph_id: str | None = None
    status: RunStatus | None = None
    started_after: datetime | None = None
    started_before: datetime | None = None
    trigger: str | None = None
    search: str | None = None


class RunCatalog:
    """SQLite-backed run catalog (UI/analytics-oriented; separate from workspace run catalog)."""

    def __init__(self, db_path: Path | str):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._local = threading.local()
        self._init_schema()

    def _get_conn(self) -> sqlite3.Connection:
        if not hasattr(self._local, "conn") or self._local.conn is None:
            self._local.conn = sqlite3.connect(str(self.db_path), timeout=30.0)
            self._local.conn.row_factory = sqlite3.Row
        return self._local.conn

    def close(self) -> None:
        conn = getattr(self._local, "conn", None)
        if conn is not None:
            try:
                conn.close()
            finally:
                self._local.conn = None

    def _init_schema(self) -> None:
        conn = self._get_conn()
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS runs (
                run_id TEXT PRIMARY KEY,
                graph_id TEXT NOT NULL,
                graph_name TEXT NOT NULL,
                status TEXT NOT NULL,
                started_at TEXT NOT NULL,
                finished_at TEXT,
                node_count INTEGER DEFAULT 0,
                event_count INTEGER DEFAULT 0,
                error_message TEXT,
                artifact_dir TEXT,
                trigger TEXT DEFAULT 'manual'
            );
            CREATE INDEX IF NOT EXISTS idx_runs_graph_id ON runs(graph_id);
            CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
            CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at DESC);
            """
        )
        conn.commit()

    def insert(self, record: RunRecord) -> None:
        conn = self._get_conn()
        conn.execute(
            """
            INSERT INTO runs (
                run_id, graph_id, graph_name, status, started_at,
                finished_at, node_count, event_count, error_message,
                artifact_dir, trigger
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                record.run_id,
                record.graph_id,
                record.graph_name,
                record.status.value,
                record.started_at.isoformat(),
                record.finished_at.isoformat() if record.finished_at else None,
                record.node_count,
                record.event_count,
                record.error_message,
                record.artifact_dir,
                record.trigger,
            ),
        )
        conn.commit()

    def get(self, run_id: str) -> RunRecord | None:
        conn = self._get_conn()
        row = conn.execute("SELECT * FROM runs WHERE run_id = ?", (run_id,)).fetchone()
        if row is None:
            return None
        return RunRecord.from_row(row)

    def update_status(
        self,
        run_id: str,
        status: RunStatus,
        finished_at: datetime | None = None,
        event_count: int | None = None,
        error_message: str | None = None,
    ) -> None:
        conn = self._get_conn()
        updates: list[str] = ["status = ?"]
        params: list[Any] = [status.value]
        if finished_at:
            updates.append("finished_at = ?")
            params.append(finished_at.isoformat())
        if event_count is not None:
            updates.append("event_count = ?")
            params.append(event_count)
        if error_message is not None:
            updates.append("error_message = ?")
            params.append(error_message)
        params.append(run_id)
        conn.execute(
            f"UPDATE runs SET {', '.join(updates)} WHERE run_id = ?",
            params,
        )
        conn.commit()

    def list(
        self,
        run_filter: RunFilter | None = None,
        *,
        limit: int = 50,
        offset: int = 0,
    ) -> list[RunRecord]:
        conn = self._get_conn()
        where_clauses: list[str] = []
        params: list[Any] = []
        if run_filter:
            if run_filter.graph_id:
                where_clauses.append("graph_id = ?")
                params.append(run_filter.graph_id)
            if run_filter.status:
                where_clauses.append("status = ?")
                params.append(run_filter.status.value)
            if run_filter.started_after:
                where_clauses.append("started_at >= ?")
                params.append(run_filter.started_after.isoformat())
            if run_filter.started_before:
                where_clauses.append("started_at <= ?")
                params.append(run_filter.started_before.isoformat())
            if run_filter.trigger:
                where_clauses.append("trigger = ?")
                params.append(run_filter.trigger)
            if run_filter.search:
                where_clauses.append("graph_name LIKE ?")
                params.append(f"%{run_filter.search}%")
        where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
        params.extend([limit, offset])
        rows = conn.execute(
            f"""
            SELECT * FROM runs
            {where_sql}
            ORDER BY started_at DESC
            LIMIT ? OFFSET ?
            """,
            params,
        ).fetchall()
        return [RunRecord.from_row(r) for r in rows]

    def count(self, run_filter: RunFilter | None = None) -> int:
        conn = self._get_conn()
        where_clauses: list[str] = []
        params: list[Any] = []
        if run_filter:
            if run_filter.status:
                where_clauses.append("status = ?")
                params.append(run_filter.status.value)
            if run_filter.graph_id:
                where_clauses.append("graph_id = ?")
                params.append(run_filter.graph_id)
        where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
        row = conn.execute(f"SELECT COUNT(*) as cnt FROM runs {where_sql}", params).fetchone()
        return int(row["cnt"] if row else 0)

    def delete_before(self, before: datetime) -> int:
        conn = self._get_conn()
        cur = conn.execute(
            "DELETE FROM runs WHERE started_at < ?",
            (before.isoformat(),),
        )
        conn.commit()
        return int(cur.rowcount or 0)
