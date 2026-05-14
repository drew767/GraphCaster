# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import tempfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


@dataclass
class GraphVersion:
    graph_id: str
    version: int
    rev_hash: str
    published_at: str
    author: str = ""
    message: str = ""
    path: Path | None = field(default=None, compare=False)

    def to_dict(self) -> dict[str, Any]:
        return {
            "graphId": self.graph_id,
            "version": self.version,
            "revHash": self.rev_hash,
            "publishedAt": self.published_at,
            "author": self.author,
            "message": self.message,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "GraphVersion":
        return cls(
            graph_id=str(d.get("graphId") or d.get("graph_id", "")),
            version=int(d.get("version", 0)),
            rev_hash=str(d.get("revHash") or d.get("rev_hash", "")),
            published_at=str(d.get("publishedAt") or d.get("published_at", "")),
            author=str(d.get("author", "")),
            message=str(d.get("message", "")),
        )


def _compute_hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _versions_dir(workspace_root: Path, graph_id: str) -> Path:
    return workspace_root / "versions" / graph_id


def _draft_path(workspace_root: Path, graph_id: str) -> Path:
    return workspace_root / "graphs" / f"{graph_id}.json"


def _publish_log_path(workspace_root: Path, graph_id: str) -> Path:
    return _versions_dir(workspace_root, graph_id) / "publish-log.jsonl"


def _snapshot_filename(version: int, rev_hash: str) -> str:
    return f"v{version:04d}-{rev_hash[:16]}.json"


_FILE_LOCKS: dict[str, asyncio.Lock] = {}
_FILE_LOCKS_MUTEX = asyncio.Lock()


async def _get_file_lock(key: str) -> asyncio.Lock:
    async with _FILE_LOCKS_MUTEX:
        if key not in _FILE_LOCKS:
            _FILE_LOCKS[key] = asyncio.Lock()
        return _FILE_LOCKS[key]


def _atomic_write(path: Path, content: str) -> None:
    """Write content to path atomically via tmp + rename."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=path.parent, prefix=".tmp_")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
        os.replace(tmp_path, path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def _append_log_line(log_path: Path, entry: dict[str, Any]) -> None:
    """Append a single JSONL entry to the publish log (file already locked by caller)."""
    log_path.parent.mkdir(parents=True, exist_ok=True)
    line = json.dumps(entry, separators=(",", ":"), ensure_ascii=False) + "\n"
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(line)


def _load_log_entries(log_path: Path) -> list[dict[str, Any]]:
    if not log_path.is_file():
        return []
    entries: list[dict[str, Any]] = []
    for line in log_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            entries.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return entries


class VersionManager:
    """Manages draft/publish versioning for GraphCaster graphs.

    Workspace layout::

        graphs/
          <graphId>.json                          # editable draft
        versions/<graphId>/
          v0001-<hash16>.json                     # immutable snapshot
          publish-log.jsonl                       # one JSON entry per publish
    """

    def __init__(self, workspace_root: Path) -> None:
        self._root = Path(workspace_root).resolve()

    def _draft_path(self, graph_id: str) -> Path:
        return _draft_path(self._root, graph_id)

    def _versions_dir(self, graph_id: str) -> Path:
        return _versions_dir(self._root, graph_id)

    def _log_path(self, graph_id: str) -> Path:
        return _publish_log_path(self._root, graph_id)

    async def _lock(self, graph_id: str) -> asyncio.Lock:
        return await _get_file_lock(f"versioning:{self._root}:{graph_id}")

    def _read_draft_content(self, graph_id: str) -> str:
        p = self._draft_path(graph_id)
        if not p.is_file():
            raise FileNotFoundError(f"Draft not found for graph {graph_id!r}: {p}")
        return p.read_text(encoding="utf-8")

    def _read_snapshot_content(self, graph_id: str, version: int) -> str:
        vdir = self._versions_dir(graph_id)
        prefix = f"v{version:04d}-"
        for f in sorted(vdir.glob(f"{prefix}*.json")):
            return f.read_text(encoding="utf-8")
        raise FileNotFoundError(
            f"Snapshot not found for graph {graph_id!r} version {version}"
        )

    def _list_log_versions(self, graph_id: str) -> list[GraphVersion]:
        entries = _load_log_entries(self._log_path(graph_id))
        versions: list[GraphVersion] = []
        for e in entries:
            ver_num = int(e.get("version", 0))
            rev_hash = str(e.get("rev_hash", ""))
            snapshot_file = _snapshot_filename(ver_num, rev_hash)
            snap_path = self._versions_dir(graph_id) / snapshot_file
            versions.append(
                GraphVersion(
                    graph_id=graph_id,
                    version=ver_num,
                    rev_hash=rev_hash,
                    published_at=str(e.get("published_at", "")),
                    author=str(e.get("author", "")),
                    message=str(e.get("message", "")),
                    path=snap_path if snap_path.is_file() else None,
                )
            )
        return versions

    async def publish(
        self,
        graph_id: str,
        *,
        author: str = "",
        message: str = "",
    ) -> GraphVersion:
        """Snapshot the current draft.

        If the draft hash equals the last published version returns the existing
        version without creating a new snapshot.
        """
        lock = await self._lock(graph_id)
        async with lock:
            draft_content = await asyncio.to_thread(self._read_draft_content, graph_id)
            rev_hash = _compute_hash(draft_content)

            versions = await asyncio.to_thread(self._list_log_versions, graph_id)
            if versions:
                last = versions[-1]
                if last.rev_hash == rev_hash:
                    return last

            next_version = (versions[-1].version + 1) if versions else 1
            now = datetime.now(timezone.utc).isoformat()
            snapshot_name = _snapshot_filename(next_version, rev_hash)
            snapshot_path = self._versions_dir(graph_id) / snapshot_name

            await asyncio.to_thread(_atomic_write, snapshot_path, draft_content)

            log_entry: dict[str, Any] = {
                "version": next_version,
                "rev_hash": rev_hash,
                "published_at": now,
                "author": author,
                "message": message,
            }
            await asyncio.to_thread(_append_log_line, self._log_path(graph_id), log_entry)

            return GraphVersion(
                graph_id=graph_id,
                version=next_version,
                rev_hash=rev_hash,
                published_at=now,
                author=author,
                message=message,
                path=snapshot_path,
            )

    async def list_versions(self, graph_id: str) -> list[GraphVersion]:
        """Return all published versions in ascending order."""
        return await asyncio.to_thread(self._list_log_versions, graph_id)

    async def get_version(self, graph_id: str, version: int) -> GraphVersion:
        """Return a specific published version. Raises KeyError if not found."""
        versions = await self.list_versions(graph_id)
        for v in versions:
            if v.version == version:
                return v
        raise KeyError(f"Version {version} not found for graph {graph_id!r}")

    async def get_latest_published(self, graph_id: str) -> GraphVersion | None:
        """Return the latest published version, or None if none exists."""
        versions = await self.list_versions(graph_id)
        return versions[-1] if versions else None

    async def load_graph(self, graph_id: str, version: int | None = None) -> dict:
        """Load graph JSON as dict.

        If version is None loads the draft; otherwise loads the published snapshot.
        """
        if version is None:
            content = await asyncio.to_thread(self._read_draft_content, graph_id)
        else:
            ver = await self.get_version(graph_id, version)
            if ver.path is None or not ver.path.is_file():
                content = await asyncio.to_thread(
                    self._read_snapshot_content, graph_id, version
                )
            else:
                content = await asyncio.to_thread(ver.path.read_text, encoding="utf-8")
        return json.loads(content)

    async def rollback_draft_to(self, graph_id: str, version: int) -> None:
        """Overwrite the current draft with the specified published snapshot."""
        ver = await self.get_version(graph_id, version)
        if ver.path is None or not ver.path.is_file():
            content = await asyncio.to_thread(
                self._read_snapshot_content, graph_id, version
            )
        else:
            content = await asyncio.to_thread(ver.path.read_text, encoding="utf-8")

        draft_p = self._draft_path(graph_id)
        await asyncio.to_thread(_atomic_write, draft_p, content)

    async def diff(
        self,
        graph_id: str,
        v_a: int | None,
        v_b: int | None,
    ) -> dict[str, Any]:
        """Compare two versions (None = draft).

        Returns::

            {
                "nodes_added": [...],
                "nodes_removed": [...],
                "nodes_changed": [...],
                "edges_added": [...],
                "edges_removed": [...],
                "edges_changed": [...],
            }
        """
        doc_a = await self.load_graph(graph_id, v_a)
        doc_b = await self.load_graph(graph_id, v_b)

        def _node_map(doc: dict) -> dict[str, dict]:
            return {n["id"]: n for n in doc.get("nodes", []) if isinstance(n, dict) and "id" in n}

        def _edge_map(doc: dict) -> dict[str, dict]:
            return {e["id"]: e for e in doc.get("edges", []) if isinstance(e, dict) and "id" in e}

        nodes_a = _node_map(doc_a)
        nodes_b = _node_map(doc_b)
        edges_a = _edge_map(doc_a)
        edges_b = _edge_map(doc_b)

        all_node_ids_a = set(nodes_a)
        all_node_ids_b = set(nodes_b)
        all_edge_ids_a = set(edges_a)
        all_edge_ids_b = set(edges_b)

        nodes_added = [nodes_b[i] for i in sorted(all_node_ids_b - all_node_ids_a)]
        nodes_removed = [nodes_a[i] for i in sorted(all_node_ids_a - all_node_ids_b)]
        nodes_changed = [
            {"id": i, "before": nodes_a[i], "after": nodes_b[i]}
            for i in sorted(all_node_ids_a & all_node_ids_b)
            if nodes_a[i] != nodes_b[i]
        ]

        edges_added = [edges_b[i] for i in sorted(all_edge_ids_b - all_edge_ids_a)]
        edges_removed = [edges_a[i] for i in sorted(all_edge_ids_a - all_edge_ids_b)]
        edges_changed = [
            {"id": i, "before": edges_a[i], "after": edges_b[i]}
            for i in sorted(all_edge_ids_a & all_edge_ids_b)
            if edges_a[i] != edges_b[i]
        ]

        return {
            "nodes_added": nodes_added,
            "nodes_removed": nodes_removed,
            "nodes_changed": nodes_changed,
            "edges_added": edges_added,
            "edges_removed": edges_removed,
            "edges_changed": edges_changed,
        }
