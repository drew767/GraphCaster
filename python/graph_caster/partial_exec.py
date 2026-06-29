# Copyright GraphCaster. All Rights Reserved.

"""Backwards-compatible shim. Canonical implementation lives in ``nodes/partial.py``."""

from graph_caster.nodes.partial import (  # noqa: F401
    _compute_ancestors,
    _load_outputs_from_run,
    build_pinned_context,
)
