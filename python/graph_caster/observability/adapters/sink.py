# Copyright GraphCaster. All Rights Reserved.

"""TraceAdapterSink — wraps an existing RunEventSink and fans events to a TraceAdapter.

The adapter is invoked *after* the inner sink so the primary event path is never
blocked or disrupted by adapter failures.  All exceptions from adapter calls are
caught and logged; they never propagate to the runner.
"""

from __future__ import annotations

import logging
from typing import Any

from graph_caster.run_event_sink import RunEventDict, RunEventSink
from graph_caster.observability.adapters.base import TraceAdapter

_LOG = logging.getLogger(__name__)

_LLM_NODE_TYPES = frozenset({"llm", "llm_agent", "agent", "gcCursorAgent"})


def _safe(fn: Any, *args: Any, **kwargs: Any) -> None:
    try:
        fn(*args, **kwargs)
    except Exception:
        _LOG.debug("trace adapter error in %s", fn, exc_info=True)


class TraceAdapterSink:
    """A RunEventSink that forwards events to both *inner* and *adapter*.

    Adapter failures are silently logged; the inner sink always wins.
    """

    __slots__ = ("_inner", "_adapter", "_node_inputs")

    def __init__(self, inner: RunEventSink, adapter: TraceAdapter) -> None:
        self._inner = inner
        self._adapter = adapter
        self._node_inputs: dict[str, dict] = {}

    def emit(self, event: RunEventDict) -> None:
        self._inner.emit(event)
        self._dispatch(event)

    def _dispatch(self, event: RunEventDict) -> None:
        ev_type = event.get("type", "")
        run_id = str(event.get("runId", ""))
        try:
            if ev_type == "run_started":
                graph_id = str(event.get("rootGraphId") or event.get("graphId") or "")
                metadata: dict = {
                    k: v for k, v in event.items()
                    if k not in {"type", "runId", "rootGraphId", "graphId"}
                }
                _safe(self._adapter.on_run_started, run_id, graph_id, metadata)

            elif ev_type == "node_execute":
                node_id = str(event.get("nodeId", ""))
                node_type = str(event.get("nodeType", ""))
                inputs = dict(event.get("data") or {})
                self._node_inputs[node_id] = inputs
                _safe(self._adapter.on_node_started, run_id, node_id, node_type, inputs)

            elif ev_type == "node_exit":
                node_id = str(event.get("nodeId", ""))
                node_type = str(event.get("nodeType", ""))
                outputs: dict = {}
                usage: dict | None = event.get("usage")  # type: ignore[assignment]
                _safe(
                    self._adapter.on_node_finished,
                    run_id,
                    node_id,
                    outputs,
                    None,
                    usage,
                )
                self._node_inputs.pop(node_id, None)

            elif ev_type == "error":
                node_id = str(event.get("nodeId", ""))
                if node_id and node_id in self._node_inputs:
                    error_info = {"message": str(event.get("message", event))}
                    _safe(
                        self._adapter.on_node_finished,
                        run_id,
                        node_id,
                        {},
                        error_info,
                        None,
                    )
                    self._node_inputs.pop(node_id, None)

            elif ev_type == "run_finished":
                status = str(event.get("status", "unknown"))
                summary: dict = {
                    k: v for k, v in event.items()
                    if k not in {"type", "runId", "status"}
                }
                _safe(self._adapter.on_run_finished, run_id, status, summary)

        except Exception:
            _LOG.debug("trace adapter dispatch error for event type %s", ev_type, exc_info=True)
