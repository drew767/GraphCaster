# Copyright GraphCaster. All Rights Reserved.

"""JSONL-based audit log query layer with cursor pagination."""

from __future__ import annotations

import base64
import hashlib
import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from graph_caster.audit.audit_event import AuditEvent, _bump_query_counter

_LOG = logging.getLogger(__name__)


def _parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return None


def _event_dt(ev: AuditEvent) -> datetime | None:
    return _parse_dt(ev.timestamp)


def _encode_cursor(event_id: str) -> str:
    return base64.urlsafe_b64encode(event_id.encode()).decode()


def _decode_cursor(cursor: str) -> str | None:
    try:
        return base64.urlsafe_b64decode(cursor.encode()).decode()
    except Exception:
        return None


class AuditQuery:
    """Query layer over a JSONL audit log file.

    Streams the file and filters in-memory.  Suitable for logs up to ~100 MB;
    for larger files rotate externally.
    """

    def __init__(self, log_path: Path) -> None:
        self._log_path = log_path

    def _iter_events(self) -> list[AuditEvent]:
        if not self._log_path.exists():
            return []
        events: list[AuditEvent] = []
        try:
            with self._log_path.open(encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        d = json.loads(line)
                        if not isinstance(d, dict):
                            continue
                        ev = AuditEvent(
                            id=str(d.get("id", "")),
                            timestamp=str(d.get("timestamp", "")),
                            actor=str(d.get("actor", "")),
                            actor_kind=d.get("actor_kind", "system"),  # type: ignore[arg-type]
                            tenant_id=str(d.get("tenant_id", "default")),
                            action=str(d.get("action", "")),
                            target_kind=str(d.get("target_kind", "")),
                            target_id=str(d.get("target_id", "")),
                            result=d.get("result", "success"),  # type: ignore[arg-type]
                            metadata=d.get("metadata") or {},
                            ip=d.get("ip"),
                            user_agent=d.get("user_agent"),
                            prev_hash=str(d.get("prev_hash", "")),
                            entry_hash=str(d.get("entry_hash", "")),
                        )
                        events.append(ev)
                    except Exception:
                        _LOG.debug("audit: skip malformed line", exc_info=True)
        except OSError:
            _LOG.debug("audit: could not read log file", exc_info=True)
        return events

    async def query(
        self,
        *,
        actor: str | None = None,
        tenant_id: str | None = None,
        action: str | None = None,
        target_kind: str | None = None,
        target_id: str | None = None,
        result: str | None = None,
        since: str | None = None,
        until: str | None = None,
        limit: int = 100,
        cursor: str | None = None,
    ) -> tuple[list[AuditEvent], str | None]:
        """Return (events, next_cursor).

        Streams JSONL and filters in-memory.
        ``cursor`` is an opaque base64-encoded event id to start after.
        """
        _bump_query_counter()

        since_dt = _parse_dt(since)
        until_dt = _parse_dt(until)

        events = self._iter_events()

        # Apply cursor — skip all events up to and including the cursor event
        if cursor is not None:
            cursor_id = _decode_cursor(cursor)
            if cursor_id is not None:
                skip = True
                filtered_from_cursor: list[AuditEvent] = []
                for ev in events:
                    if skip:
                        if ev.id == cursor_id:
                            skip = False
                        continue
                    filtered_from_cursor.append(ev)
                events = filtered_from_cursor

        # Apply filters
        result_list: list[AuditEvent] = []
        for ev in events:
            if actor is not None and ev.actor != actor:
                continue
            if tenant_id is not None and ev.tenant_id != tenant_id:
                continue
            if action is not None and ev.action != action:
                continue
            if target_kind is not None and ev.target_kind != target_kind:
                continue
            if target_id is not None and ev.target_id != target_id:
                continue
            if result is not None and ev.result != result:
                continue
            if since_dt is not None:
                ev_dt = _event_dt(ev)
                if ev_dt is None or ev_dt < since_dt:
                    continue
            if until_dt is not None:
                ev_dt = _event_dt(ev)
                if ev_dt is None or ev_dt > until_dt:
                    continue
            result_list.append(ev)
            if len(result_list) >= limit + 1:
                break

        if len(result_list) > limit:
            page = result_list[:limit]
            next_cursor = _encode_cursor(page[-1].id)
        else:
            page = result_list
            next_cursor = None

        return page, next_cursor


# ---- Tamper-evident verification ----

from graph_caster.audit.audit_event import _compute_entry_hash


def verify_chain(log_path: Path) -> list[dict[str, Any]]:
    """Walk the JSONL log and verify chain hashes.

    Returns a list of dicts describing mismatches.  Empty list means log is intact.
    """
    if not log_path.exists():
        return []

    errors: list[dict[str, Any]] = []
    prev_hash = ""
    index = 0

    try:
        with log_path.open(encoding="utf-8") as f:
            for raw_line in f:
                raw_line = raw_line.strip()
                if not raw_line:
                    continue
                try:
                    d = json.loads(raw_line)
                except json.JSONDecodeError as exc:
                    errors.append({
                        "index": index,
                        "error": "json_decode",
                        "detail": str(exc),
                    })
                    index += 1
                    continue

                stored_prev = d.get("prev_hash", "")
                stored_entry = d.get("entry_hash", "")

                # Check prev_hash linkage
                if stored_prev != prev_hash:
                    errors.append({
                        "index": index,
                        "id": d.get("id"),
                        "error": "prev_hash_mismatch",
                        "expected": prev_hash,
                        "got": stored_prev,
                    })

                # Check entry_hash integrity
                expected_entry = _compute_entry_hash(d)
                if stored_entry != expected_entry:
                    errors.append({
                        "index": index,
                        "id": d.get("id"),
                        "error": "entry_hash_mismatch",
                        "expected": expected_entry,
                        "got": stored_entry,
                    })

                prev_hash = stored_entry
                index += 1
    except OSError as exc:
        errors.append({"index": -1, "error": "io_error", "detail": str(exc)})

    return errors
