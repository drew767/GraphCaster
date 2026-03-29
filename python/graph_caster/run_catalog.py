# Copyright GraphCaster. All Rights Reserved.

"""SQLite index of root run metadata (n8n/Flowise-style execution list) — derived from run-summary.json."""

from __future__ import annotations

import json
import logging
import os
import sqlite3
from pathlib import Path
from typing import Any

_LOG = logging.getLogger(__name__)

_CATALOG_SCHEMA_VERSION = 1

_VALID_STATUS = frozenset({"success", "failed", "cancelled", "partial"})


def catalog_db_path(artifacts_base: Path) -> Path:
    base = Path(artifacts_base).resolve()
    d = base / ".graphcaster"
    return d / "runs_catalog.sqlite3"


def is_run_catalog_enabled() -> bool:
    v = os.environ.get("GC_RUN_CATALOG", "").strip().lower()
    return v not in ("0", "false", "no")


def _try_wal_mode(conn: sqlite3.Connection) -> None:
    try:
        conn.execute("PRAGMA journal_mode=WAL")
    except sqlite3.Error:
        _LOG.debug("run_catalog: WAL not available, using default journal mode", exc_info=True)


def _migrate_schema_forward(conn: sqlite3.Connection, from_ver: int, to_ver: int) -> None:
    """
    Incremental DDL without dropping rows. Add ALTER/CREATE branches when bumping
    _CATALOG_SCHEMA_VERSION (e.g. new columns); then set user_version.
    """
    v = from_ver
    while v < to_ver:
        next_v = v + 1
        # Example for v2:
        # if v == 1 and next_v == 2:
        #     conn.execute("ALTER TABLE runs ADD COLUMN new_col TEXT")
        v = next_v
    conn.execute(f"PRAGMA user_version = {to_ver}")


def _ensure_schema(conn: sqlite3.Connection) -> None:
    _try_wal_mode(conn)
    cur = conn.execute("PRAGMA user_version")
    ver = int(cur.fetchone()[0])

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS runs (
          run_id TEXT PRIMARY KEY,
          root_graph_id TEXT NOT NULL,
          run_dir_name TEXT NOT NULL,
          status TEXT NOT NULL,
          started_at TEXT,
          finished_at TEXT NOT NULL,
          artifact_relpath TEXT NOT NULL
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_runs_graph_finished "
        "ON runs (root_graph_id, finished_at DESC)"
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_runs_finished ON runs (finished_at DESC)")

    if ver == 0:
        conn.execute(f"PRAGMA user_version = {_CATALOG_SCHEMA_VERSION}")
    elif ver < _CATALOG_SCHEMA_VERSION:
        _migrate_schema_forward(conn, ver, _CATALOG_SCHEMA_VERSION)
    elif ver > _CATALOG_SCHEMA_VERSION:
        _LOG.warning(
            "run_catalog: database user_version %s newer than package %s; read/write may mismatch",
            ver,
            _CATALOG_SCHEMA_VERSION,
        )


def _ensure_catalog_dir(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)


def _layout_under_runs(artifacts_base: Path, run_dir: Path) -> tuple[str, str]:
    """Validate run_dir is artifacts_base/runs/<graphId>/<runDirName>; return (graph_id, run_dir_name)."""
    ab = Path(artifacts_base).resolve()
    rd = Path(run_dir).resolve()
    runs_root = ab / "runs"
    try:
        rel = rd.relative_to(runs_root)
    except ValueError as e:
        raise ValueError("run_dir must be under artifacts_base/runs") from e
    parts = rel.parts
    if len(parts) != 2:
        raise ValueError("run_dir must be runs/<graphId>/<runDirName>")
    return parts[0], parts[1]


def _row_from_summary(
    graph_folder: str,
    run_name: str,
    summary: dict[str, Any],
) -> tuple[str, str, str, str, str | None, str, str]:
    run_id = str(summary.get("runId") or "").strip()
    if not run_id:
        raise ValueError("summary.runId required")
    root_gid = str(summary.get("rootGraphId") or "").strip()
    if not root_gid:
        raise ValueError("summary.rootGraphId required")
    status = str(summary.get("status") or "").strip()
    if status not in _VALID_STATUS:
        raise ValueError(f"summary.status must be one of {sorted(_VALID_STATUS)}")
    finished_at = str(summary.get("finishedAt") or "").strip()
    if not finished_at:
        raise ValueError("summary.finishedAt required")
    started_raw = summary.get("startedAt")
    started_at = str(started_raw).strip() if started_raw is not None else None
    if started_at == "":
        started_at = None
    artifact_relpath = f"runs/{graph_folder}/{run_name}"
    return run_id, root_gid, run_name, status, started_at, finished_at, artifact_relpath


def _upsert_connection(
    conn: sqlite3.Connection,
    artifacts_base: Path,
    run_dir: Path,
    summary: dict[str, Any],
) -> None:
    graph_folder, run_name = _layout_under_runs(artifacts_base, run_dir)
    run_id, root_gid, _run_dir_name, status, started_at, finished_at, relpath = _row_from_summary(
        graph_folder, run_name, summary
    )
    conn.execute(
        """
        INSERT INTO runs (
          run_id, root_graph_id, run_dir_name, status, started_at, finished_at, artifact_relpath
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(run_id) DO UPDATE SET
          root_graph_id = excluded.root_graph_id,
          run_dir_name = excluded.run_dir_name,
          status = excluded.status,
          started_at = excluded.started_at,
          finished_at = excluded.finished_at,
          artifact_relpath = excluded.artifact_relpath
        """,
        (run_id, root_gid, run_name, status, started_at, finished_at, relpath),
    )


def upsert_run_from_summary(
    artifacts_base: Path,
    run_dir: Path,
    summary: dict[str, Any],
) -> None:
    """Record or update a run row from the same payload written to run-summary.json."""
    if not is_run_catalog_enabled():
        return
    try:
        _layout_under_runs(artifacts_base, run_dir)
    except ValueError:
        return
    db_path = catalog_db_path(artifacts_base)
    try:
        _ensure_catalog_dir(db_path)
        conn = sqlite3.connect(str(db_path), timeout=30.0)
    except OSError as e:
        _LOG.debug("run_catalog: cannot open db %s: %s", db_path, e)
        return
    try:
        _ensure_schema(conn)
        _upsert_connection(conn, artifacts_base, run_dir, summary)
        conn.commit()
    except (ValueError, OSError, sqlite3.Error) as e:
        _LOG.debug("run_catalog upsert failed: %s", e, exc_info=True)
        conn.rollback()
    finally:
        conn.close()


def list_run_catalog_rows(
    artifacts_base: Path,
    *,
    graph_id: str | None = None,
    status: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[dict[str, Any]]:
    """Return catalog rows as JSON-ready dicts (camelCase)."""
    db_path = catalog_db_path(artifacts_base)
    if not db_path.is_file():
        return []
    if limit < 0:
        limit = 0
    if offset < 0:
        offset = 0
    conn = sqlite3.connect(str(db_path), timeout=30.0)
    try:
        _ensure_schema(conn)
        conds: list[str] = []
        params: list[Any] = []
        if graph_id and str(graph_id).strip():
            conds.append("root_graph_id = ?")
            params.append(str(graph_id).strip())
        if status and str(status).strip():
            conds.append("status = ?")
            params.append(str(status).strip())
        where = (" WHERE " + " AND ".join(conds)) if conds else ""
        sql = (
            "SELECT run_id, root_graph_id, run_dir_name, status, started_at, finished_at, artifact_relpath "
            f"FROM runs{where} ORDER BY finished_at DESC LIMIT ? OFFSET ?"
        )
        params.extend([limit, offset])
        cur = conn.execute(sql, params)
        rows: list[dict[str, Any]] = []
        for tup in cur.fetchall():
            rid, rgid, rdn, st, sta, fin, arp = tup
            rows.append(
                {
                    "runId": rid,
                    "rootGraphId": rgid,
                    "runDirName": rdn,
                    "run_dir_name": rdn,
                    "status": st,
                    "startedAt": sta,
                    "finishedAt": fin,
                    "artifactRelPath": arp.replace("\\", "/"),
                }
            )
        return rows
    finally:
        conn.close()


def rebuild_catalog_from_disk(artifacts_base: Path) -> int:
    """
    Full rebuild: delete all rows, scan runs/<graphId>/<runDir>/run-summary.json.
    Ignores GC_RUN_CATALOG (for offline repair).
    Returns number of rows inserted.
    """
    ab = Path(artifacts_base).resolve()
    runs_root = ab / "runs"
    db_path = catalog_db_path(ab)
    _ensure_catalog_dir(db_path)
    conn = sqlite3.connect(str(db_path), timeout=60.0)
    count = 0
    try:
        _ensure_schema(conn)
        conn.execute("DELETE FROM runs")
        if runs_root.is_dir():
            for gdir in sorted(runs_root.iterdir()):
                if not gdir.is_dir():
                    continue
                for rdir in sorted(gdir.iterdir()):
                    if not rdir.is_dir():
                        continue
                    sp = rdir / "run-summary.json"
                    if not sp.is_file():
                        continue
                    try:
                        data = json.loads(sp.read_text(encoding="utf-8"))
                    except (json.JSONDecodeError, OSError):
                        continue
                    if not isinstance(data, dict):
                        continue
                    try:
                        _upsert_connection(conn, ab, rdir, data)
                        count += 1
                    except ValueError:
                        continue
        conn.commit()
        return count
    except OSError:
        conn.rollback()
        raise
    finally:
        conn.close()
