# Copyright GraphCaster. All Rights Reserved.

"""Error-handler registry and dispatch for F72 (trigger_error node type).

A graph that has ``start.data.kind == "error_handler"`` and a ``trigger_error``
node at the top is registered as an error handler.  When a source graph run
finishes with a terminal failure status the registry finds matching handlers
and dispatches new runs with failure context.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from graph_caster.models import GraphDocument

__all__ = [
    "ErrorHandler",
    "ErrorHandlerRegistry",
    "ErrorHandlerDispatcher",
]

_LOG = logging.getLogger(__name__)

_HANDLER_STATUSES = frozenset({"failed", "cancelled", "timeout"})


@dataclass
class ErrorHandler:
    graph_id: str
    node_id: str
    sources: set[str]
    triggers: set[str]


class ErrorHandlerRegistry:
    """Scans a graphs directory for ``trigger_error`` nodes and matches them
    against source graph IDs and terminal run statuses.
    """

    def __init__(self, graphs_dir: Path) -> None:
        self._graphs_dir = Path(graphs_dir)
        self._handlers: list[ErrorHandler] = []

    async def reload(self) -> None:
        """Scan graphs_dir for trigger_error nodes; populate registry."""
        import asyncio

        handlers = await asyncio.to_thread(self._scan_sync)
        self._handlers = handlers

    def reload_sync(self) -> None:
        """Synchronous variant of :meth:`reload` (usable without an event loop)."""
        self._handlers = self._scan_sync()

    def _scan_sync(self) -> list[ErrorHandler]:
        handlers: list[ErrorHandler] = []
        d = self._graphs_dir
        if not d.is_dir():
            return handlers
        for path in sorted(d.glob("*.json")):
            if not path.is_file():
                continue
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                _LOG.debug("error_handlers: skipping %s: %s", path.name, exc)
                continue
            try:
                doc = GraphDocument.from_dict(raw)
            except ValueError as exc:
                _LOG.debug("error_handlers: invalid doc %s: %s", path.name, exc)
                continue
            found = _extract_handlers(doc)
            handlers.extend(found)
        _LOG.debug("error_handlers: reloaded %d handlers from %s", len(handlers), d)
        return handlers

    def find_handlers_for(self, graph_id: str, reason: str) -> list[ErrorHandler]:
        """Return handlers whose sources match *graph_id* and *reason* is in their triggers."""
        if reason not in _HANDLER_STATUSES:
            return []
        out: list[ErrorHandler] = []
        for h in self._handlers:
            if reason not in h.triggers:
                continue
            if "*" in h.sources or graph_id in h.sources:
                out.append(h)
        return out


def _extract_handlers(doc: GraphDocument) -> list[ErrorHandler]:
    """Return :class:`ErrorHandler` entries found in *doc* (may be empty)."""
    trigger_nodes = [n for n in doc.nodes if n.type == "trigger_error"]
    if not trigger_nodes:
        return []
    handlers: list[ErrorHandler] = []
    for node in trigger_nodes:
        d = node.data or {}
        raw_sources = d.get("sourceGraphIds", ["*"])
        if isinstance(raw_sources, list) and raw_sources:
            sources: set[str] = {str(s) for s in raw_sources if isinstance(s, str) and str(s).strip()}
        else:
            sources = {"*"}
        if not sources:
            sources = {"*"}

        raw_triggers = d.get("triggerOn", ["failed"])
        if isinstance(raw_triggers, list) and raw_triggers:
            triggers: set[str] = {str(t) for t in raw_triggers if str(t) in _HANDLER_STATUSES}
        else:
            triggers = {"failed"}
        if not triggers:
            triggers = {"failed"}

        handlers.append(
            ErrorHandler(
                graph_id=doc.graph_id,
                node_id=node.id,
                sources=sources,
                triggers=triggers,
            )
        )
    return handlers


class ErrorHandlerDispatcher:
    """Connects an :class:`ErrorHandlerRegistry` to the broker's run-finished hook.

    Usage::

        registry = ErrorHandlerRegistry(graphs_dir)
        registry.reload_sync()
        dispatcher = ErrorHandlerDispatcher(registry, start_run_fn=my_start_fn)
        broker_registry.set_run_finished_hook(dispatcher.on_run_finished)

    ``start_run_fn(graph_id, context)`` is called once per matching handler.
    It must be safe to call from a background thread.  Exceptions are swallowed.
    """

    def __init__(
        self,
        handler_registry: ErrorHandlerRegistry,
        *,
        start_run_fn: Callable[[str, dict[str, Any]], None],
    ) -> None:
        self._registry = handler_registry
        self._start_run_fn = start_run_fn

    def on_run_finished(self, event: dict[str, Any]) -> None:
        """Called by the broker's run-finished hook with the parsed JSON event.

        Must never raise.
        """
        try:
            self._dispatch(event)
        except Exception:
            _LOG.debug("ErrorHandlerDispatcher.on_run_finished raised", exc_info=True)

    def _dispatch(self, event: dict[str, Any]) -> None:
        status = str(event.get("status") or "").strip()
        if status not in _HANDLER_STATUSES:
            return
        source_graph_id = str(event.get("rootGraphId") or event.get("graphId") or "").strip()
        if not source_graph_id:
            return
        source_run_id = str(event.get("runId") or "").strip()
        handlers = self._registry.find_handlers_for(source_graph_id, status)
        if not handlers:
            return

        error_raw = event.get("error")
        if isinstance(error_raw, dict):
            error: dict[str, Any] = dict(error_raw)
        elif isinstance(error_raw, str) and error_raw:
            error = {"message": error_raw}
        else:
            error = {}

        started_at = str(event.get("startedAt") or "")
        finished_at = str(event.get("finishedAt") or "")

        payload = build_error_handler_payload(
            source_graph_id=source_graph_id,
            source_run_id=source_run_id,
            source_status=status,
            error=error,
            started_at=started_at,
            finished_at=finished_at,
        )
        for handler in handlers:
            try:
                self._start_run_fn(handler.graph_id, payload)
            except Exception:
                _LOG.debug(
                    "ErrorHandlerDispatcher: start_run_fn failed for handler %s",
                    handler.graph_id,
                    exc_info=True,
                )


def build_error_handler_payload(
    *,
    source_graph_id: str,
    source_run_id: str,
    source_status: str,
    error: dict[str, Any] | None,
    started_at: str,
    finished_at: str,
) -> dict[str, Any]:
    """Build the context payload injected into the handler graph run."""
    return {
        "source_graph_id": source_graph_id,
        "source_run_id": source_run_id,
        "source_status": source_status,
        "error": error or {},
        "started_at": started_at,
        "finished_at": finished_at,
    }
