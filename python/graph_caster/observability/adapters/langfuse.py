# Copyright GraphCaster. All Rights Reserved.

"""Langfuse trace adapter.

Requires: ``graph-caster[trace-langfuse]``  (httpx>=0.27)
Env vars:
    GC_TRACE_BACKEND=langfuse
    LANGFUSE_HOST           — e.g. https://cloud.langfuse.com
    LANGFUSE_PUBLIC_KEY     — pk-lf-...
    LANGFUSE_SECRET_KEY     — sk-lf-...
"""

from __future__ import annotations

import base64
import datetime
import logging
import os
import threading
import uuid
from typing import Any, ClassVar

from graph_caster.observability.adapters.base import TraceAdapter

_LOG = logging.getLogger(__name__)

_LLM_NODE_TYPES = frozenset({"llm", "llm_agent", "agent", "gcCursorAgent"})

_INGESTION_PATH = "/api/public/ingestion"


def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def _basic_auth(public_key: str, secret_key: str) -> str:
    raw = f"{public_key}:{secret_key}"
    return "Basic " + base64.b64encode(raw.encode()).decode()


class LangfuseAdapter(TraceAdapter):
    """Sends runs as Langfuse traces and nodes as spans (or generations for LLM nodes)."""

    name: ClassVar[str] = "langfuse"

    def __init__(
        self,
        *,
        host: str | None = None,
        public_key: str | None = None,
        secret_key: str | None = None,
    ) -> None:
        self._host = (host or os.environ.get("LANGFUSE_HOST", "https://cloud.langfuse.com")).rstrip("/")
        self._public_key = public_key or os.environ.get("LANGFUSE_PUBLIC_KEY", "")
        self._secret_key = secret_key or os.environ.get("LANGFUSE_SECRET_KEY", "")
        self._auth = _basic_auth(self._public_key, self._secret_key)
        self._batch: list[dict[str, Any]] = []
        self._lock = threading.Lock()

    # --- lifecycle ----------------------------------------------------------

    def on_run_started(self, run_id: str, graph_id: str, metadata: dict) -> None:
        event = {
            "id": str(uuid.uuid4()),
            "type": "trace-create",
            "body": {
                "id": run_id,
                "name": f"gc.run/{graph_id}",
                "metadata": {"graph_id": graph_id, **metadata},
                "timestamp": _now_iso(),
            },
        }
        self._batch.append(event)

    def on_node_started(self, run_id: str, node_id: str, node_type: str, inputs: dict) -> None:
        span_type = "generation-create" if node_type in _LLM_NODE_TYPES else "span-create"
        event = {
            "id": str(uuid.uuid4()),
            "type": span_type,
            "body": {
                "id": node_id,
                "traceId": run_id,
                "name": f"gc.node/{node_type}",
                "input": inputs,
                "startTime": _now_iso(),
                "metadata": {"node_type": node_type},
            },
        }
        self._batch.append(event)

    def on_node_finished(
        self,
        run_id: str,
        node_id: str,
        outputs: dict,
        error: dict | None,
        usage: dict | None,
    ) -> None:
        node_type_hint = "generation" if any(
            b.get("body", {}).get("id") == node_id and b.get("type", "").startswith("generation")
            for b in self._batch
        ) else "span"
        update_type = f"{node_type_hint}-update"
        body: dict[str, Any] = {
            "id": node_id,
            "traceId": run_id,
            "output": outputs,
            "endTime": _now_iso(),
            "level": "ERROR" if error else "DEFAULT",
        }
        if error:
            body["statusMessage"] = str(error.get("message", error))
        if usage and node_type_hint == "generation":
            body["usage"] = usage
        event = {
            "id": str(uuid.uuid4()),
            "type": update_type,
            "body": body,
        }
        self._batch.append(event)

    def on_run_finished(self, run_id: str, status: str, summary: dict) -> None:
        event = {
            "id": str(uuid.uuid4()),
            "type": "trace-create",
            "body": {
                "id": run_id,
                "metadata": {"status": status, **summary},
                "timestamp": _now_iso(),
            },
        }
        self._batch.append(event)

    async def flush(self, *, _transport: Any = None) -> None:
        with self._lock:
            if not self._batch:
                return
            batch = list(self._batch)
            self._batch.clear()
        await self._send_batch(batch, _transport=_transport)

    # --- internal -----------------------------------------------------------

    async def _send_batch(self, batch: list[dict[str, Any]], *, _transport: Any = None) -> None:
        try:
            import httpx
        except ImportError:
            _LOG.warning("langfuse adapter: httpx not installed; install graph-caster[trace-langfuse]")
            return
        url = self._host + _INGESTION_PATH
        payload = {"batch": batch}
        client_kwargs: dict[str, Any] = {}
        if _transport is not None:
            client_kwargs["transport"] = _transport
        try:
            async with httpx.AsyncClient(**client_kwargs) as client:
                resp = await client.post(
                    url,
                    json=payload,
                    headers={
                        "Authorization": self._auth,
                        "Content-Type": "application/json",
                    },
                    timeout=10.0,
                )
                resp.raise_for_status()
        except Exception:
            _LOG.warning("langfuse adapter: failed to send batch (%d events)", len(batch), exc_info=True)
