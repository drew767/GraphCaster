# Copyright Aura. All Rights Reserved.

from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from graph_caster.run_broker.errors import PendingQueueFullError
from graph_caster.run_broker.registry import RunBrokerRegistry
from graph_caster.workspace import resolve_graph_path


def _artifacts_base_from_env() -> Path | None:
    raw = os.environ.get("GC_RUN_BROKER_ARTIFACTS_BASE", "").strip()
    return Path(raw).resolve() if raw else None


def _graphs_dir_from_env() -> Path | None:
    raw = os.environ.get("GC_RUN_BROKER_GRAPHS_DIR", "").strip()
    return Path(raw).resolve() if raw else None


def _workspace_root_from_env() -> Path | None:
    raw = os.environ.get("GC_RUN_BROKER_WORKSPACE_ROOT", "").strip()
    return Path(raw).resolve() if raw else None


_TERMINAL_STATUSES = frozenset({"success", "failed", "cancelled", "partial"})


class BrokerRegistryRunManager:
    """Adapts :class:`RunBrokerRegistry` to the async API v1 run manager protocol."""

    def __init__(
        self,
        registry: RunBrokerRegistry,
        *,
        graphs_dir: Path | None = None,
        artifacts_base: Path | None = None,
        workspace_root: Path | None = None,
    ) -> None:
        self._registry = registry
        self._graphs_dir = Path(graphs_dir).resolve() if graphs_dir else None
        self._artifacts_base = Path(artifacts_base).resolve() if artifacts_base else None
        self._workspace_root = Path(workspace_root).resolve() if workspace_root else None
        self._run_graph: dict[str, str] = {}
        self._run_created: dict[str, str] = {}

    @classmethod
    def from_env(cls, registry: RunBrokerRegistry) -> BrokerRegistryRunManager:
        return cls(
            registry,
            graphs_dir=_graphs_dir_from_env(),
            artifacts_base=_artifacts_base_from_env(),
            workspace_root=_workspace_root_from_env(),
        )

    def _find_summary_sync(self, graph_id: str, run_id: str) -> dict[str, Any] | None:
        if not self._artifacts_base:
            return None
        root = self._artifacts_base / "runs" / graph_id
        if not root.is_dir():
            return None
        for sub in sorted(root.iterdir(), key=lambda p: p.name, reverse=True):
            if not sub.is_dir():
                continue
            p = sub / "run-summary.json"
            if not p.is_file():
                continue
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                continue
            if str(data.get("runId", "")) == run_id:
                return data
        return None

    async def start_run(
        self,
        graph_id: str,
        context: dict[str, Any] | None = None,
        trigger_context: dict[str, Any] | None = None,  # noqa: ARG002
    ) -> str:
        del trigger_context
        if self._graphs_dir is None:
            raise ValueError(
                "Run broker graphs directory is not configured (set GC_RUN_BROKER_GRAPHS_DIR)"
            )
        gdir = self._graphs_dir
        path = await asyncio.to_thread(resolve_graph_path, gdir, graph_id)
        if path is None:
            raise FileNotFoundError(f"Graph not found: {graph_id}")

        doc_json = await asyncio.to_thread(path.read_text, encoding="utf-8")
        body: dict[str, Any] = {
            "documentJson": doc_json,
            "contextJson": context if context is not None else {},
            "graphsDir": str(gdir),
        }
        if self._workspace_root is not None:
            body["workspaceRoot"] = str(self._workspace_root)
        if self._artifacts_base is not None:
            body["artifactsBase"] = str(self._artifacts_base)

        try:
            sp = await asyncio.to_thread(self._registry.spawn_from_body, body)
        except PendingQueueFullError:
            raise
        self._run_graph[sp.run_id] = graph_id
        self._run_created[sp.run_id] = datetime.now(timezone.utc).isoformat()
        return sp.run_id

    async def get_run_status(self, run_id: str) -> dict[str, Any] | None:
        graph_id = self._run_graph.get(run_id)
        reg = self._registry.get(run_id)
        created_at = self._run_created.get(run_id, "")

        if reg is not None:
            gid = graph_id or ""
            if reg.proc is None:
                return {
                    "run_id": run_id,
                    "graph_id": gid,
                    "status": "queued",
                    "created_at": created_at,
                    "outputs": None,
                    "error": None,
                }
            if reg.proc.poll() is None:
                return {
                    "run_id": run_id,
                    "graph_id": gid,
                    "status": "running",
                    "created_at": created_at,
                    "outputs": None,
                    "error": None,
                }
            return {
                "run_id": run_id,
                "graph_id": gid,
                "status": "running",
                "created_at": created_at,
                "outputs": None,
                "error": None,
            }

        if graph_id:
            summary = await asyncio.to_thread(self._find_summary_sync, graph_id, run_id)
            if summary is not None:
                st = str(summary.get("status", "unknown"))
                return {
                    "run_id": run_id,
                    "graph_id": graph_id,
                    "status": st,
                    "created_at": str(summary.get("startedAt") or created_at),
                    "outputs": None,
                    "error": None,
                }
        return None

    async def wait_for_run(self, run_id: str, timeout: float = 300.0) -> dict[str, Any]:
        loop = asyncio.get_event_loop()
        deadline = loop.time() + max(0.1, timeout)
        while True:
            st = await self.get_run_status(run_id)
            if st is None:
                return {"status": "not_found", "error": "Run not found", "outputs": None}
            name = st.get("status", "")
            if name in _TERMINAL_STATUSES:
                return {
                    "status": name,
                    "outputs": st.get("outputs"),
                    "error": st.get("error"),
                }
            if loop.time() >= deadline:
                return {"status": "timeout", "error": "wait_for_run timed out", "outputs": None}
            await asyncio.sleep(0.15)

    async def cancel_run(self, run_id: str) -> dict[str, Any]:
        ok = await asyncio.to_thread(self._registry.cancel, run_id)
        if not ok:
            return {"cancelled": False, "message": "Run not found or cancel failed"}
        return {"cancelled": True, "message": None}
