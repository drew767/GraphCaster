# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
from pathlib import Path

from graph_caster.models import GraphDocument


class WorkspaceIndexError(ValueError):
    pass


def load_graph_documents_index(directory: Path) -> dict[str, tuple[Path, GraphDocument]]:
    if not directory.is_dir():
        raise WorkspaceIndexError(f"graphs directory does not exist or is not a directory: {directory}")
    index: dict[str, tuple[Path, GraphDocument]] = {}
    for path in sorted(directory.glob("*.json")):
        if not path.is_file():
            continue
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            raise WorkspaceIndexError(f"cannot read graph JSON {path}: {e}") from e
        try:
            doc = GraphDocument.from_dict(raw)
        except ValueError as e:
            raise WorkspaceIndexError(f"invalid graph document in {path}: {e}") from e
        gid = doc.graph_id
        if not gid or gid == "default":
            continue
        if gid in index:
            raise WorkspaceIndexError(
                f"duplicate graphId {gid!r}: {index[gid][0].name} and {path.name} in {directory}"
            )
        index[gid] = (path, doc)
    return index


def scan_graphs_directory(directory: Path) -> dict[str, Path]:
    return {gid: path for gid, (path, _) in load_graph_documents_index(directory).items()}


def _graphs_index_stamp(directory: Path) -> tuple[int, int, int]:
    try:
        dir_ns = directory.stat().st_mtime_ns
    except OSError:
        dir_ns = -1
    max_file_ns = -1
    nfiles = 0
    try:
        for path in directory.glob("*.json"):
            if not path.is_file():
                continue
            nfiles += 1
            try:
                m = path.stat().st_mtime_ns
                if m > max_file_ns:
                    max_file_ns = m
            except OSError:
                pass
    except OSError:
        pass
    if max_file_ns < 0:
        max_file_ns = dir_ns
    return (dir_ns, max_file_ns, nfiles)


_GRAPH_INDEX_CACHE: dict[str, tuple[tuple[int, int, int], dict[str, Path]]] = {}


def clear_graph_index_cache() -> None:
    _GRAPH_INDEX_CACHE.clear()


def resolve_graph_path(graphs_root: Path, graph_id: str) -> Path | None:
    root = graphs_root.resolve()
    key = str(root)
    stamp = _graphs_index_stamp(root)
    cached = _GRAPH_INDEX_CACHE.get(key)
    if cached is None or cached[0] != stamp:
        idx = scan_graphs_directory(graphs_root)
        stamp_after = _graphs_index_stamp(root)
        _GRAPH_INDEX_CACHE[key] = (stamp_after, idx)
    else:
        idx = cached[1]
    return idx.get(graph_id)
