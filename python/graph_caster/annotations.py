# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import asyncio
import json
import os
import uuid
import weakref
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncIterator


@dataclass
class Annotation:
    id: str
    run_id: str
    node_id: str | None = None
    rating: int | None = None
    comment: str = ""
    suggested_output: dict | None = None
    labels: list[str] = field(default_factory=list)
    author: str = ""
    created_at: str = ""

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "Annotation":
        return cls(
            id=str(d.get("id", "")),
            run_id=str(d.get("run_id", "")),
            node_id=d.get("node_id"),
            rating=d.get("rating"),
            comment=str(d.get("comment", "")),
            suggested_output=d.get("suggested_output"),
            labels=list(d.get("labels", [])),
            author=str(d.get("author", "")),
            created_at=str(d.get("created_at", "")),
        )


def _run_dir(artifacts_base: Path, graph_id: str, run_id: str) -> Path:
    """Locate runs/<graphId>/<runDirName>/ by scanning for a run-summary with matching runId."""
    root = artifacts_base / "runs" / graph_id
    if not root.is_dir():
        return root / run_id
    for sub in sorted(root.iterdir(), key=lambda p: p.name, reverse=True):
        if not sub.is_dir():
            continue
        summary = sub / "run-summary.json"
        if summary.is_file():
            try:
                data = json.loads(summary.read_text(encoding="utf-8"))
                if str(data.get("runId", "")) == run_id:
                    return sub
            except (json.JSONDecodeError, OSError):
                pass
    return root / run_id


def _annotations_path(artifacts_base: Path, graph_id: str, run_id: str) -> Path:
    return _run_dir(artifacts_base, graph_id, run_id) / "annotations.jsonl"


# Per-path locks are cached as weak values so they self-evict once no caller holds a strong
# reference (i.e. nothing is currently waiting on / inside the critical section). This keeps the map
# bounded even when a long-running broker handles many distinct run paths.
_LOCKS: "weakref.WeakValueDictionary[str, asyncio.Lock]" = weakref.WeakValueDictionary()
_LOCKS_MUTEX = asyncio.Lock()


async def _get_lock(key: str) -> asyncio.Lock:
    async with _LOCKS_MUTEX:
        existing = _LOCKS.get(key)
        if existing is not None:
            return existing
        lock = asyncio.Lock()
        _LOCKS[key] = lock
        return lock


def _locks_size() -> int:
    """Test helper: number of live cached locks. Forces a GC pass so dead refs are pruned."""
    import gc

    gc.collect()
    return len(_LOCKS)


class AnnotationStore:
    """File-backed annotation store.

    Annotations are stored per-run as JSON Lines in:
        <artifacts_base>/runs/<graphId>/<runDir>/annotations.jsonl
    """

    def __init__(self, artifacts_base: Path) -> None:
        self._base = Path(artifacts_base).resolve()

    def _path(self, graph_id: str, run_id: str) -> Path:
        return _annotations_path(self._base, graph_id, run_id)

    async def add(self, graph_id: str, ann: Annotation) -> None:
        if not ann.id:
            ann.id = str(uuid.uuid4())
        if not ann.created_at:
            ann.created_at = datetime.now(timezone.utc).isoformat()

        path = self._path(graph_id, ann.run_id)
        lock_key = str(path)
        lock = await _get_lock(lock_key)
        line = json.dumps(ann.to_dict(), ensure_ascii=False) + "\n"

        async with lock:
            await asyncio.to_thread(_append_line, path, line)

    async def list_for_run(self, graph_id: str, run_id: str) -> list[Annotation]:
        path = self._path(graph_id, run_id)
        return await asyncio.to_thread(_read_annotations, path)

    async def list_for_graph(self, graph_id: str) -> list[Annotation]:
        root = self._base / "runs" / graph_id
        results: list[Annotation] = []
        if not await asyncio.to_thread(root.is_dir):
            return results
        for sub in await asyncio.to_thread(lambda: sorted(root.iterdir())):
            if not sub.is_dir():
                continue
            p = sub / "annotations.jsonl"
            if p.is_file():
                results.extend(await asyncio.to_thread(_read_annotations, p))
        return results

    async def list_all(self) -> AsyncIterator[Annotation]:
        runs_root = self._base / "runs"
        if not runs_root.is_dir():
            return
        for graph_dir in sorted(runs_root.iterdir()):
            if not graph_dir.is_dir():
                continue
            for run_dir in sorted(graph_dir.iterdir()):
                if not run_dir.is_dir():
                    continue
                p = run_dir / "annotations.jsonl"
                if p.is_file():
                    for ann in _read_annotations(p):
                        yield ann

    async def delete(self, graph_id: str, run_id: str, annotation_id: str) -> bool:
        path = self._path(graph_id, run_id)
        lock_key = str(path)
        lock = await _get_lock(lock_key)
        async with lock:
            return await asyncio.to_thread(_delete_annotation, path, annotation_id)


def _append_line(path: Path, line: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".jsonl.tmp_" + str(os.getpid()))
    if path.is_file():
        existing = path.read_bytes()
    else:
        existing = b""
    tmp.write_bytes(existing + line.encode("utf-8"))
    tmp.replace(path)


def _read_annotations(path: Path) -> list[Annotation]:
    if not path.is_file():
        return []
    results = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        raw = raw.strip()
        if not raw:
            continue
        try:
            d = json.loads(raw)
            results.append(Annotation.from_dict(d))
        except (json.JSONDecodeError, KeyError, TypeError):
            pass
    return results


def _delete_annotation(path: Path, annotation_id: str) -> bool:
    if not path.is_file():
        return False
    anns = _read_annotations(path)
    original_len = len(anns)
    anns = [a for a in anns if a.id != annotation_id]
    if len(anns) == original_len:
        return False
    tmp = path.with_suffix(".jsonl.tmp_del_" + str(os.getpid()))
    content = "".join(json.dumps(a.to_dict(), ensure_ascii=False) + "\n" for a in anns)
    tmp.write_text(content, encoding="utf-8")
    tmp.replace(path)
    return True
