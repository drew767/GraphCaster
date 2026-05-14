# Copyright GraphCaster. All Rights Reserved.

"""F86 — Public sharing links for graphs.

File-backed store at .graphcaster/share-links.jsonl (atomic append).
"""

from __future__ import annotations

import asyncio
import json
import os
import secrets
import threading
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

__all__ = [
    "ShareLink",
    "ShareLinkStore",
    "ShareLinkExpiredError",
    "ShareLinkExhaustedError",
    "ShareLinkNotFoundError",
]

_STORE_FILENAME = "share-links.jsonl"
_TOKEN_BYTES = 32

_VALID_PERMISSIONS = frozenset({"view", "run", "view-and-run"})


class ShareLinkNotFoundError(KeyError):
    pass


class ShareLinkExpiredError(ValueError):
    pass


class ShareLinkExhaustedError(ValueError):
    pass


@dataclass
class ShareLink:
    id: str
    graph_id: str
    graph_version: int | None
    permissions: Literal["view", "run", "view-and-run"]
    expires_at: str | None
    max_uses: int | None
    uses: int = 0
    created_by: str = ""
    created_at: str = ""
    metadata: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "graphId": self.graph_id,
            "graphVersion": self.graph_version,
            "permissions": self.permissions,
            "expiresAt": self.expires_at,
            "maxUses": self.max_uses,
            "uses": self.uses,
            "createdBy": self.created_by,
            "createdAt": self.created_at,
            "metadata": self.metadata,
        }

    @staticmethod
    def from_dict(d: dict) -> "ShareLink":
        return ShareLink(
            id=str(d["id"]),
            graph_id=str(d.get("graphId") or d.get("graph_id") or ""),
            graph_version=d.get("graphVersion") or d.get("graph_version"),
            permissions=d.get("permissions", "view"),
            expires_at=d.get("expiresAt") or d.get("expires_at"),
            max_uses=d.get("maxUses") if d.get("maxUses") is not None else d.get("max_uses"),
            uses=int(d.get("uses", 0)),
            created_by=str(d.get("createdBy") or d.get("created_by") or ""),
            created_at=str(d.get("createdAt") or d.get("created_at") or ""),
            metadata=dict(d.get("metadata") or {}),
        )

    def is_expired(self) -> bool:
        if self.expires_at is None:
            return False
        try:
            exp = datetime.fromisoformat(self.expires_at.replace("Z", "+00:00"))
            return datetime.now(timezone.utc) > exp
        except ValueError:
            return False

    def is_exhausted(self) -> bool:
        return self.max_uses is not None and self.uses >= self.max_uses

    def allows_run(self) -> bool:
        return self.permissions in ("run", "view-and-run")

    def allows_view(self) -> bool:
        return self.permissions in ("view", "view-and-run")


def _generate_link_id() -> str:
    return secrets.token_urlsafe(_TOKEN_BYTES)


class ShareLinkStore:
    """File-backed share link store at .graphcaster/share-links.jsonl."""

    def __init__(self, workspace_root: Path) -> None:
        self._root = Path(workspace_root)
        self._path = self._root / ".graphcaster" / _STORE_FILENAME
        self._lock = threading.Lock()
        self._index: dict[str, ShareLink] | None = None

    def _ensure_dir(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)

    def _load_all(self) -> dict[str, ShareLink]:
        links: dict[str, ShareLink] = {}
        if not self._path.exists():
            return links
        try:
            text = self._path.read_text(encoding="utf-8")
        except OSError:
            return links
        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                d = json.loads(line)
                lnk = ShareLink.from_dict(d)
                links[lnk.id] = lnk
            except (json.JSONDecodeError, KeyError, TypeError):
                continue
        return links

    def _rebuild_file(self, links: dict[str, ShareLink]) -> None:
        self._ensure_dir()
        tmp = self._path.with_suffix(".jsonl.tmp")
        lines = [
            json.dumps(lnk.to_dict(), ensure_ascii=False, separators=(",", ":"))
            for lnk in links.values()
        ]
        tmp.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
        tmp.replace(self._path)

    def _append_link(self, lnk: ShareLink) -> None:
        self._ensure_dir()
        line = json.dumps(lnk.to_dict(), ensure_ascii=False, separators=(",", ":")) + "\n"
        with self._path.open("a", encoding="utf-8") as f:
            f.write(line)

    async def create(self, link: ShareLink) -> ShareLink:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._create_sync, link)

    def _create_sync(self, link: ShareLink) -> ShareLink:
        with self._lock:
            if not link.id:
                link.id = _generate_link_id()
            if not link.created_at:
                link.created_at = datetime.now(timezone.utc).isoformat()
            self._append_link(link)
            self._index = None
            return link

    async def get(self, link_id: str, *, check_expired: bool = False) -> ShareLink | None:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._get_sync, link_id, check_expired)

    def _get_sync(self, link_id: str, check_expired: bool) -> ShareLink | None:
        with self._lock:
            index = self._load_all()
            self._index = index
        lnk = index.get(link_id)
        if lnk is None:
            return None
        if check_expired and (lnk.is_expired() or lnk.is_exhausted()):
            return None
        return lnk

    async def list_for_graph(self, graph_id: str) -> list[ShareLink]:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._list_for_graph_sync, graph_id)

    def _list_for_graph_sync(self, graph_id: str) -> list[ShareLink]:
        with self._lock:
            index = self._load_all()
        return [lnk for lnk in index.values() if lnk.graph_id == graph_id]

    async def list_for_user(self, user_id: str) -> list[ShareLink]:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._list_for_user_sync, user_id)

    def _list_for_user_sync(self, user_id: str) -> list[ShareLink]:
        with self._lock:
            index = self._load_all()
        return [lnk for lnk in index.values() if lnk.created_by == user_id]

    async def revoke(self, link_id: str) -> None:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._revoke_sync, link_id)

    def _revoke_sync(self, link_id: str) -> None:
        with self._lock:
            index = self._load_all()
            if link_id not in index:
                raise ShareLinkNotFoundError(link_id)
            del index[link_id]
            self._rebuild_file(index)
            self._index = None

    async def consume(self, link_id: str) -> ShareLink:
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, self._consume_sync, link_id)

    def _consume_sync(self, link_id: str) -> ShareLink:
        with self._lock:
            index = self._load_all()
            lnk = index.get(link_id)
            if lnk is None:
                raise ShareLinkNotFoundError(link_id)
            if lnk.is_expired():
                raise ShareLinkExpiredError(f"Share link {link_id} has expired")
            if lnk.is_exhausted():
                raise ShareLinkExhaustedError(f"Share link {link_id} has reached max uses")
            lnk.uses += 1
            index[link_id] = lnk
            self._rebuild_file(index)
            self._index = None
            return lnk


_PUBLIC_SHARE_RATE_LIMIT_DEFAULT = 60


def _rate_limit_default() -> int:
    raw = os.environ.get("GC_PUBLIC_SHARE_RATE_LIMIT", "").strip()
    try:
        v = int(raw)
        return max(1, v)
    except (ValueError, TypeError):
        return _PUBLIC_SHARE_RATE_LIMIT_DEFAULT


class _RateLimiter:
    """Per-link in-memory sliding-window rate limiter (requests per minute)."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._buckets: dict[str, list[float]] = {}

    def check(self, key: str, limit: int) -> tuple[bool, float]:
        """Return (allowed, retry_after_secs). retry_after_secs is 0 when allowed."""
        import time

        now = time.monotonic()
        window = 60.0
        with self._lock:
            bucket = self._buckets.get(key, [])
            bucket = [ts for ts in bucket if now - ts < window]
            if len(bucket) >= limit:
                oldest = bucket[0]
                retry_after = window - (now - oldest)
                self._buckets[key] = bucket
                return False, max(0.0, retry_after)
            bucket.append(now)
            self._buckets[key] = bucket
            return True, 0.0


_default_rate_limiter = _RateLimiter()


def get_rate_limiter() -> _RateLimiter:
    return _default_rate_limiter
