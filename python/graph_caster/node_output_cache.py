# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import hashlib
import json
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

__all__ = [
    "StepCachePolicy",
    "StepCacheStore",
    "compute_step_cache_key",
    "node_data_for_cache_key",
    "normalize_outputs_for_cache_key",
    "stable_json",
    "step_cache_root",
    "upstream_outputs_fingerprint",
]


@dataclass(frozen=True)
class StepCachePolicy:
    enabled: bool
    dirty_nodes: frozenset[str] = frozenset()


def stable_json(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)


def normalize_outputs_for_cache_key(outputs: Mapping[str, Any]) -> dict[str, Any]:
    return json.loads(json.dumps(dict(outputs), sort_keys=True, default=str))


def node_data_for_cache_key(data: Mapping[str, Any]) -> dict[str, Any]:
    filtered = {k: v for k, v in data.items() if k != "stepCache"}
    return json.loads(json.dumps(filtered, sort_keys=True, default=str))


def upstream_outputs_fingerprint(outputs: Mapping[str, Any]) -> str:
    norm = normalize_outputs_for_cache_key(outputs)
    return hashlib.sha256(stable_json(norm).encode("utf-8")).hexdigest()


def _coerce_step_cache_entry(raw: dict[str, Any]) -> dict[str, Any] | None:
    if raw.get("nodeType") != "task":
        return None
    if not isinstance(raw.get("data"), dict):
        return None
    pr = raw.get("processResult")
    if not isinstance(pr, dict) or "success" not in pr:
        return None
    return raw


def compute_step_cache_key(
    *,
    graph_rev: str,
    graph_id: str,
    node_id: str,
    node_data: Mapping[str, Any],
    upstream_outputs: Mapping[str, Any],
    tenant_id: str | None = None,
    workspace_secrets_file_fp: str | None = None,
) -> str:
    payload: dict[str, Any] = {
        "data": node_data_for_cache_key(node_data),
        "gid": graph_id,
        "gr": graph_rev,
        "nid": node_id,
        "up_fp": upstream_outputs_fingerprint(upstream_outputs),
    }
    if tenant_id is not None and str(tenant_id).strip():
        payload["tenant"] = str(tenant_id).strip()
    if workspace_secrets_file_fp is not None:
        payload["ws_sec_fp"] = workspace_secrets_file_fp
    return hashlib.sha256(stable_json(payload).encode("utf-8")).hexdigest()


def step_cache_root(artifacts_base: Path, graph_id: str) -> Path:
    from graph_caster.artifacts import _artifact_graph_root

    return _artifact_graph_root(artifacts_base, graph_id) / "step-cache" / "v1"


class StepCacheStore:
    def __init__(self, root: Path) -> None:
        self._root = Path(root)

    def _path_for(self, key_hex: str) -> Path:
        if len(key_hex) < 4:
            return self._root / "xx" / "xx" / f"{key_hex}.json"
        return self._root / key_hex[:2] / key_hex[2:4] / f"{key_hex}.json"

    def get(self, key_hex: str) -> dict[str, Any] | None:
        p = self._path_for(key_hex)
        if not p.is_file():
            return None
        try:
            raw = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        if not isinstance(raw, dict):
            return None
        return _coerce_step_cache_entry(raw)

    def put(self, key_hex: str, entry: dict[str, Any]) -> None:
        p = self._path_for(key_hex)
        p.parent.mkdir(parents=True, exist_ok=True)
        data = stable_json(entry).encode("utf-8")
        fd, tmp = tempfile.mkstemp(suffix=".json", dir=p.parent, text=False)
        try:
            os.write(fd, data)
            os.close(fd)
            fd = -1
            os.replace(tmp, p)
        finally:
            if fd >= 0:
                try:
                    os.close(fd)
                except OSError:
                    pass
            if os.path.exists(tmp):
                try:
                    os.remove(tmp)
                except OSError:
                    pass
