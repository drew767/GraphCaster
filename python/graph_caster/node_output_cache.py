# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import hashlib
import json
import os
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Mapping, Sequence

if TYPE_CHECKING:
    from graph_caster.models import GraphDocument

__all__ = [
    "StepCachePolicy",
    "StepCacheStore",
    "compute_step_cache_key",
    "node_data_for_cache_key",
    "normalize_outputs_for_cache_key",
    "stable_json",
    "step_cache_root",
    "upstream_outputs_fingerprint",
    "upstream_step_cache_fingerprint",
    "validate_ai_route_step_cache_entry",
]


def _positive_int_ge1(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool) and v >= 1


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


def upstream_step_cache_fingerprint(
    outputs: Mapping[str, Any],
    *,
    graph_ref_revisions: Sequence[tuple[str, str]] = (),
) -> str:
    """SHA-256 of upstream node outputs for step-cache keys.

    When ``graph_ref_revisions`` is non-empty, each pair is ``(graph_ref_node_id,
    graph_document_revision_hex)`` for a direct predecessor of type ``graph_ref``,
    sorted by node id. Empty sequence preserves the legacy fingerprint of outputs
    alone (same as historical ``upstream_outputs_fingerprint``).
    """
    norm = normalize_outputs_for_cache_key(outputs)
    if not graph_ref_revisions:
        return hashlib.sha256(stable_json(norm).encode("utf-8")).hexdigest()
    pairs = sorted((str(a), str(r)) for a, r in graph_ref_revisions)
    combined = {"g": pairs, "o": norm}
    return hashlib.sha256(stable_json(combined).encode("utf-8")).hexdigest()


def upstream_outputs_fingerprint(outputs: Mapping[str, Any]) -> str:
    return upstream_step_cache_fingerprint(outputs, graph_ref_revisions=())


def _coerce_step_cache_entry(raw: dict[str, Any]) -> dict[str, Any] | None:
    nt = raw.get("nodeType")
    if not isinstance(raw.get("data"), dict):
        return None
    if nt == "task":
        pr = raw.get("processResult")
        if not isinstance(pr, dict) or "success" not in pr:
            return None
        if pr.get("success") is not True:
            return None
        return raw
    if nt == "mcp_tool":
        mt = raw.get("mcpTool")
        if not isinstance(mt, dict) or "success" not in mt:
            return None
        if mt.get("success") is not True:
            return None
        return raw
    if nt == "ai_route":
        ar = raw.get("aiRoute")
        if not isinstance(ar, dict):
            return None
        if not _positive_int_ge1(ar.get("choiceIndex")):
            return None
        eid = ar.get("edgeId")
        if not isinstance(eid, str) or not eid.strip():
            return None
        return raw
    if nt == "llm_agent":
        pr = raw.get("processResult")
        if not isinstance(pr, dict) or pr.get("success") is not True:
            return None
        ar = raw.get("agentResult")
        if not isinstance(ar, dict) or ar.get("success") is not True:
            return None
        return raw
    return None


def validate_ai_route_step_cache_entry(doc: "GraphDocument", node_id: str, cached: Mapping[str, Any]) -> bool:
    """True if cached ``aiRoute`` matches current ``usable_ai_route_out_edges`` order and ids."""
    from graph_caster.ai_routing import usable_ai_route_out_edges

    ar = cached.get("aiRoute")
    if not isinstance(ar, dict):
        return False
    ci = ar.get("choiceIndex")
    eid_raw = ar.get("edgeId")
    if not _positive_int_ge1(ci):
        return False
    if not isinstance(eid_raw, str) or not eid_raw.strip():
        return False
    outgoing = usable_ai_route_out_edges(doc, node_id)
    if ci > len(outgoing):
        return False
    if outgoing[ci - 1].id != eid_raw:
        return False
    return True


def compute_step_cache_key(
    *,
    graph_rev: str,
    graph_id: str,
    node_id: str,
    node_data: Mapping[str, Any],
    upstream_outputs: Mapping[str, Any],
    tenant_id: str | None = None,
    workspace_secrets_file_fp: str | None = None,
    graph_ref_upstream_revisions: Sequence[tuple[str, str]] | None = None,
    cache_node_kind: str = "task",
) -> str:
    pairs: Sequence[tuple[str, str]] = (
        () if graph_ref_upstream_revisions is None else graph_ref_upstream_revisions
    )
    up_fp = upstream_step_cache_fingerprint(upstream_outputs, graph_ref_revisions=pairs)
    payload: dict[str, Any] = {
        "data": node_data_for_cache_key(node_data),
        "gid": graph_id,
        "gr": graph_rev,
        "nid": node_id,
        "nk": str(cache_node_kind),
        "up_fp": up_fp,
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
        self._lock = threading.Lock()

    def _path_for(self, key_hex: str) -> Path:
        if len(key_hex) < 4:
            return self._root / "xx" / "xx" / f"{key_hex}.json"
        return self._root / key_hex[:2] / key_hex[2:4] / f"{key_hex}.json"

    def get(self, key_hex: str) -> dict[str, Any] | None:
        with self._lock:
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
        with self._lock:
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
