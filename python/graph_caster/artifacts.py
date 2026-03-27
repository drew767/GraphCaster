# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


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


def write_run_summary(run_dir: Path, payload: dict[str, Any]) -> None:
    p = Path(run_dir) / "run-summary.json"
    tmp = p.with_suffix(".json.tmp")
    data = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    tmp.write_text(data, encoding="utf-8")
    tmp.replace(p)


def safe_artifact_run_dir_name(name: str) -> str:
    s = str(name).strip()
    if not s or ".." in s or "/" in s or "\\" in s:
        raise ValueError("invalid run directory name")
    return s


def resolve_persisted_run_dir(artifacts_base: Path, graph_id: str, run_dir_name: str) -> Path:
    base = Path(artifacts_base).resolve()
    gid = _normalized_graph_id_for_path(graph_id)
    leaf = safe_artifact_run_dir_name(run_dir_name)
    d = base / "runs" / gid / leaf
    return d.resolve()


def list_persisted_run_dir_names(artifacts_base: Path, graph_id: str) -> list[str]:
    root = _artifact_graph_root(artifacts_base, graph_id)
    if not root.is_dir():
        return []
    names = [p.name for p in root.iterdir() if p.is_dir()]
    return sorted(names, reverse=True)


def list_persisted_run_entries(artifacts_base: Path, graph_id: str) -> list[dict[str, Any]]:
    root = _artifact_graph_root(artifacts_base, graph_id)
    if not root.is_dir():
        return []
    rows: list[dict[str, Any]] = []
    for p in sorted((x for x in root.iterdir() if x.is_dir()), key=lambda x: x.name, reverse=True):
        rows.append(
            {
                "runDirName": p.name,
                "hasEvents": (p / "events.ndjson").is_file(),
                "hasSummary": (p / "run-summary.json").is_file(),
            }
        )
    return rows


def read_persisted_events_ndjson_capped(
    artifacts_base: Path,
    graph_id: str,
    run_dir_name: str,
    max_bytes: int,
) -> tuple[str, bool]:
    if max_bytes < 0:
        raise ValueError("max_bytes must be non-negative")
    d = resolve_persisted_run_dir(artifacts_base, graph_id, run_dir_name)
    if not d.is_dir():
        return "", False
    p = d / "events.ndjson"
    if not p.is_file():
        return "", False
    data = p.read_bytes()
    if len(data) <= max_bytes:
        return data.decode("utf-8", errors="replace"), False
    return data[-max_bytes:].decode("utf-8", errors="replace"), True


def read_persisted_run_summary_text(
    artifacts_base: Path,
    graph_id: str,
    run_dir_name: str,
) -> str | None:
    d = resolve_persisted_run_dir(artifacts_base, graph_id, run_dir_name)
    p = d / "run-summary.json"
    if not p.is_file():
        return None
    return p.read_text(encoding="utf-8")


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
