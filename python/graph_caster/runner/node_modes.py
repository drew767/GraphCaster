# Copyright GraphCaster. All Rights Reserved.

"""UX127b/UX128b — Node mode runtime helpers.

* ``bypass`` — skip the node's own work, but make a best-effort pass-through
  of the first upstream successful output so downstream nodes can still
  consume something. Surfaces the ``node_bypassed`` event with a flag
  indicating whether a pass-through value was available.

* ``mute`` / ``disabled`` — skip the node entirely; downstream traversal from
  this node is suppressed. Surfaces the ``node_skipped`` event.

The actual mode dispatch is wired into ``graph_runner.py`` immediately after
the ``node_enter`` event and before any redact/execute work.
"""

from __future__ import annotations

from typing import Any

from graph_caster.models import Node


def is_skipped_mode(mode: str) -> bool:
    """``True`` if the node should be entirely skipped (no execute, no traverse)."""
    return mode in ("mute", "disabled")


def is_bypass_mode(mode: str) -> bool:
    """``True`` if the node should be replaced by a pass-through of upstream output."""
    return mode == "bypass"


def compute_bypass_passthrough(
    node: Node,
    incoming_sources: list[str],
    node_outputs: dict[str, Any],
) -> tuple[dict[str, Any], bool]:
    """Build the ``node_outputs[node.id]`` entry for a bypassed node.

    Strategy: take the first available upstream entry's ``out_default``-style
    payload (or its ``data`` if no explicit out_default), and propagate it as
    this node's ``out_default``. Returns ``(entry, has_passthrough)``.

    If no upstream is present yet (e.g. bypassing a root-adjacent node), we
    still return a valid entry but ``has_passthrough = False`` — downstream
    will see the node's own ``data`` and an empty ``out_default``.
    """
    base: dict[str, Any] = {
        "nodeType": node.type,
        "data": dict(node.data),
        "bypassed": True,
    }
    for src_id in incoming_sources:
        up = node_outputs.get(src_id)
        if not isinstance(up, dict):
            continue
        # Prefer an explicit out_default if upstream stored one (e.g. fork/merge).
        if "out_default" in up:
            base["out_default"] = up["out_default"]
            return base, True
        # Fall back to upstream data — this is what most visit functions store.
        if "data" in up:
            base["out_default"] = up["data"]
            return base, True
    return base, False
