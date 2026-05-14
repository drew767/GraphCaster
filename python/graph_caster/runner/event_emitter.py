# Copyright GraphCaster. All Rights Reserved.

"""Event emission helpers for :class:`GraphRunner`.

Encapsulates the threading lock + sink dispatch + ``runId`` stamping, plus
the node-outputs snapshot redaction path. Anything that calls ``sink.emit``
on behalf of a runner should go through here.
"""

from __future__ import annotations

import threading
from typing import Any

from graph_caster.run_event_sink import RunEventDict, RunEventSink


class RunEventEmitter:
    """Thread-safe wrapper around a :class:`RunEventSink`.

    Owns the emit-lock so concurrent fork-parallel workers cannot interleave
    NDJSON-style payloads on a shared sink. ``run_id`` and ``graph_id`` are
    stamped into every event when provided.
    """

    def __init__(
        self,
        sink: RunEventSink,
        *,
        graph_id: str,
        run_id: str | None = None,
    ) -> None:
        self._sink: RunEventSink = sink
        self._graph_id = graph_id
        self._run_id = run_id
        self._lock = threading.Lock()

    @property
    def lock(self) -> threading.Lock:
        return self._lock

    @property
    def sink(self) -> RunEventSink:
        return self._sink

    def replace_sink(self, sink: RunEventSink) -> None:
        """Swap the underlying sink (used when wrapping in a tee/persist sink)."""
        self._sink = sink

    @property
    def run_id(self) -> str | None:
        return self._run_id

    def set_run_id(self, run_id: str | None) -> None:
        self._run_id = run_id

    def emit(self, event_type: str, **payload: Any) -> None:
        ev: RunEventDict = {"type": event_type, **payload}
        rid = self._run_id
        if rid:
            ev["runId"] = rid
        with self._lock:
            self._sink.emit(ev)

    def emit_node_outputs_snapshot(
        self,
        ctx: dict[str, Any],
        node_id: str,
        outs_slice: dict[str, Any],
    ) -> None:
        """Emit ``node_outputs_snapshot`` with pin trim, optional operator redaction policy."""
        from graph_caster.gc_pin import snapshot_for_pin_event
        from graph_caster.redaction.run_event_redaction import (
            redact_snapshot_payload,
            snapshot_redaction_enabled,
        )

        snap = snapshot_for_pin_event(outs_slice)
        if snapshot_redaction_enabled(ctx):
            snap = redact_snapshot_payload(snap)
        self.emit(
            "node_outputs_snapshot",
            nodeId=node_id,
            graphId=self._graph_id,
            snapshot=snap,
        )
