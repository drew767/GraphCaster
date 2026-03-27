# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path


def _normalized_graph_id_for_path(graph_id: str) -> str:
    gid = str(graph_id).strip()
    if not gid or gid == "default":
        raise ValueError("graph_id must be a non-empty id and not 'default'")
    if ".." in gid or "/" in gid or "\\" in gid:
        raise ValueError("graph_id must not contain path separators or '..'")
    return gid


def _artifact_graph_root(artifacts_base: Path, graph_id: str) -> Path:
    base = Path(artifacts_base).resolve()
    gid = _normalized_graph_id_for_path(graph_id)
    return base / "runs" / gid


def create_root_run_artifact_dir(artifacts_base: Path, root_graph_id: str) -> Path:
    base = Path(artifacts_base).resolve()
    gid = _normalized_graph_id_for_path(root_graph_id)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    suffix = uuid.uuid4().hex[:8]
    run_dir = base / "runs" / gid / f"{stamp}_{suffix}"
    run_dir.mkdir(parents=True, exist_ok=False)
    return run_dir


def tree_bytes(path: Path) -> int:
    p = Path(path)
    if not p.exists():
        return 0
    if p.is_file():
        return p.stat().st_size
    total = 0
    for child in p.rglob("*"):
        if child.is_file():
            total += child.stat().st_size
    return total


def artifacts_tree_bytes_for_graph(artifacts_base: Path, graph_id: str) -> int:
    root = _artifact_graph_root(artifacts_base, graph_id)
    return tree_bytes(root)


def artifacts_runs_total_bytes(artifacts_base: Path) -> int:
    base = Path(artifacts_base).resolve()
    runs = base / "runs"
    return tree_bytes(runs)


def clear_artifacts_for_graph(artifacts_base: Path, graph_id: str) -> None:
    root = _artifact_graph_root(artifacts_base, graph_id)
    if root.is_dir():
        shutil.rmtree(root, ignore_errors=False)


def clear_all_artifact_runs(artifacts_base: Path) -> None:
    base = Path(artifacts_base).resolve()
    runs = base / "runs"
    if runs.is_dir():
        shutil.rmtree(runs, ignore_errors=False)
