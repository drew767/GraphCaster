# Copyright Aura. All Rights Reserved.

"""Optional redaction for :class:`node_outputs_snapshot` run events (operator / policy)."""

from __future__ import annotations

import copy
import os
from typing import Any

from graph_caster.ai_routing import _redact_object


def snapshot_redaction_enabled(ctx: dict[str, Any]) -> bool:
    """True when snapshot bodies should be passed through :func:`redact_snapshot_payload`.

    Enabled when run ``context`` sets ``redact_node_outputs_snapshot`` to a truthy value,
    or when env ``GC_RUN_SNAPSHOT_REDACT`` is ``1`` / ``true`` / ``yes`` / ``on``.
    """
    if ctx.get("redact_node_outputs_snapshot"):
        return True
    v = (os.environ.get("GC_RUN_SNAPSHOT_REDACT") or "").strip().lower()
    return v in ("1", "true", "yes", "on")


def redact_snapshot_payload(snapshot: dict[str, Any]) -> dict[str, Any]:
    """Return a deep copy of *snapshot* with sensitive keys under ``processResult`` scrubbed."""
    o = copy.deepcopy(snapshot)
    pr = o.get("processResult")
    if isinstance(pr, dict):
        o["processResult"] = _redact_object(pr, max_depth=8, max_bytes=262_144)
    return o
