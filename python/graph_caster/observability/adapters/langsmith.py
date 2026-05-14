# Copyright GraphCaster. All Rights Reserved.

"""LangSmith trace adapter.

Requires: ``graph-caster[trace-langsmith]``  (httpx>=0.27)
Env vars:
    GC_TRACE_BACKEND=langsmith
    LANGSMITH_ENDPOINT      — e.g. https://api.smith.langchain.com
    LANGSMITH_API_KEY       — ls__...
"""

from __future__ import annotations

import datetime
import logging
import os
import threading
import uuid
from typing import Any, ClassVar

from graph_caster.observability.adapters.base import TraceAdapter

_LOG = logging.getLogger(__name__)

_RUNS_PATH = "/runs"


def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


class LangSmithAdapter(TraceAdapter):
    """Maps GraphCaster runs/nodes to LangSmith run objects."""

    name: ClassVar[str] = "langsmith"

    def __init__(
        self,
        *,
        endpoint: str | None = None,
        api_key: str | None = None,
    ) -> None:
        self._endpoint = (
            endpoint or os.environ.get("LANGSMITH_ENDPOINT", "https://api.smith.langchain.com")
        ).rstrip("/")
        self._api_key = api_key or os.environ.get("LANGSMITH_API_KEY", "")
        self._pending: list[dict[str, Any]] = []
        self._lock = threading.Lock()

    # --- lifecycle ----------------------------------------------------------

    def on_run_started(self, run_id: str, graph_id: str, metadata: dict) -> None:
        self._pending.append({
            "_action": "post",
            "id": run_id,
            "name": f"gc.run/{graph_id}",
            "run_type": "chain",
            "start_time": _now_iso(),
            "extra": {"graph_id": graph_id, **metadata},
        })

    def on_node_started(self, run_id: str, node_id: str, node_type: str, inputs: dict) -> None:
        self._pending.append({
            "_action": "post",
            "id": node_id,
            "parent_run_id": run_id,
            "name": f"gc.node/{node_type}",
            "run_type": "llm" if node_type in {"llm", "llm_agent", "agent", "gcCursorAgent"} else "tool",
            "start_time": _now_iso(),
            "inputs": inputs,
        })

    def on_node_finished(
        self,
        run_id: str,
        node_id: str,
        outputs: dict,
        error: dict | None,
        usage: dict | None,
    ) -> None:
        body: dict[str, Any] = {
            "_action": "patch",
            "id": node_id,
            "end_time": _now_iso(),
            "outputs": outputs,
        }
        if error:
            body["error"] = str(error.get("message", error))
        if usage:
            body["extra"] = {"usage": usage}
        self._pending.append(body)

    def on_run_finished(self, run_id: str, status: str, summary: dict) -> None:
        self._pending.append({
            "_action": "patch",
            "id": run_id,
            "end_time": _now_iso(),
            "outputs": {"status": status, **summary},
        })

    async def flush(self) -> None:
        with self._lock:
            if not self._pending:
                return
            pending = list(self._pending)
            self._pending.clear()
        for item in pending:
            await self._send_run(item)

    # --- internal -----------------------------------------------------------

    async def _send_run(self, item: dict[str, Any], *, _transport: Any = None) -> None:
        try:
            import httpx
        except ImportError:
            _LOG.warning("langsmith adapter: httpx not installed; install graph-caster[trace-langsmith]")
            return
        action = item.pop("_action", "post")
        run_id = item.get("id", "")
        url = self._endpoint + _RUNS_PATH
        if action == "patch":
            url = f"{url}/{run_id}"
        headers = {
            "x-api-key": self._api_key,
            "Content-Type": "application/json",
        }
        client_kwargs: dict[str, Any] = {}
        if _transport is not None:
            client_kwargs["transport"] = _transport
        try:
            async with httpx.AsyncClient(**client_kwargs) as client:
                if action == "post":
                    resp = await client.post(url, json=item, headers=headers, timeout=10.0)
                else:
                    resp = await client.patch(url, json=item, headers=headers, timeout=10.0)
                resp.raise_for_status()
        except Exception:
            _LOG.warning("langsmith adapter: failed to send run %s (%s)", run_id, action, exc_info=True)
