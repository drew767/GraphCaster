# Copyright GraphCaster. All Rights Reserved.

"""List files under a persisted run directory (debugging / tooling)."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ArtifactEntry:
    """One file or directory under a run folder (relative paths use '/' separators)."""

    rel_path: str
    is_dir: bool
    size_bytes: int | None


def _safe_rel(child: Path, root: Path) -> str:
    rel = child.relative_to(root)
    return rel.as_posix()


def list_run_artifact_tree(
    run_dir: Path,
    *,
    max_entries: int = 500,
) -> list[ArtifactEntry]:
    """
    Walk ``run_dir`` breadth-first and return stable-sorted artifact entries.

    Skips symlinks. Caps the total number of entries (files + dirs) at ``max_entries``.
    """
    root = run_dir.resolve()
    if not root.is_dir():
        return []

    out: list[ArtifactEntry] = []
    queue: list[Path] = [root]

    while queue and len(out) < max_entries:
        current = queue.pop(0)
        try:
            entries = sorted(current.iterdir(), key=lambda p: p.name.lower())
        except OSError:
            continue
        for p in entries:
            if len(out) >= max_entries:
                break
            try:
                is_dir = p.is_dir()
                is_link = p.is_symlink()
            except OSError:
                continue
            if is_link:
                continue
            rel = _safe_rel(p, root)
            size: int | None = None
            if not is_dir:
                try:
                    size = p.stat().st_size
                except OSError:
                    size = None
            out.append(ArtifactEntry(rel_path=rel, is_dir=is_dir, size_bytes=size))
            if is_dir:
                queue.append(p)

    out.sort(key=lambda e: (e.rel_path.lower(), e.is_dir))
    return out
