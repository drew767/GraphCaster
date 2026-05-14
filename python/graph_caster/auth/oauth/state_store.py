# Copyright GraphCaster. All Rights Reserved.

"""CSRF state token storage for OAuth flows."""

from __future__ import annotations

import json
import os
import time
from abc import ABC, abstractmethod
from pathlib import Path


class StateStore(ABC):
    @abstractmethod
    async def put(self, state: str, payload: dict, *, ttl_sec: int = 600) -> None:
        """Store state with associated payload and TTL."""

    @abstractmethod
    async def pop(self, state: str) -> dict | None:
        """Consume and return the payload for state, or None if expired/missing."""


class InMemoryStateStore(StateStore):
    """Thread-safe in-process state store backed by a plain dict."""

    def __init__(self) -> None:
        self._store: dict[str, tuple[dict, float]] = {}

    async def put(self, state: str, payload: dict, *, ttl_sec: int = 600) -> None:
        expires_at = time.monotonic() + ttl_sec
        self._store[state] = (dict(payload), expires_at)

    async def pop(self, state: str) -> dict | None:
        entry = self._store.pop(state, None)
        if entry is None:
            return None
        payload, expires_at = entry
        if time.monotonic() > expires_at:
            return None
        return payload


class FileStateStore(StateStore):
    """JSONL-backed state store with mtime-based TTL expiry.

    Each state token is appended as a single JSONL line. On ``pop`` the file is
    rewritten, dropping expired entries.
    """

    def __init__(self, path: Path | str) -> None:
        self._path = Path(path)

    def _read_all(self) -> list[dict]:
        if not self._path.exists():
            return []
        lines = []
        try:
            for raw in self._path.read_text(encoding="utf-8").splitlines():
                raw = raw.strip()
                if not raw:
                    continue
                try:
                    lines.append(json.loads(raw))
                except json.JSONDecodeError:
                    pass
        except OSError:
            pass
        return lines

    def _write_all(self, entries: list[dict]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(
            "\n".join(json.dumps(e, ensure_ascii=False) for e in entries) + "\n"
            if entries else "",
            encoding="utf-8",
        )

    async def put(self, state: str, payload: dict, *, ttl_sec: int = 600) -> None:
        entry = {
            "state": state,
            "payload": payload,
            "expires_at": time.time() + ttl_sec,
        }
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with self._path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    async def pop(self, state: str) -> dict | None:
        now = time.time()
        entries = self._read_all()
        found: dict | None = None
        remaining: list[dict] = []
        for entry in entries:
            if entry.get("state") == state:
                if entry.get("expires_at", 0) > now:
                    found = entry.get("payload")
            else:
                if entry.get("expires_at", 0) > now:
                    remaining.append(entry)
        self._write_all(remaining)
        return found
