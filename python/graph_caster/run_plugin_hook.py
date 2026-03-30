# Copyright GraphCaster. All Rights Reserved.

"""Optional Python hook module for run lifecycle (Phase 6.3 minimal extension point)."""

from __future__ import annotations

import importlib
import logging
import os
from typing import Any

_LOG = logging.getLogger(__name__)


def invoke_run_finished_module_maybe(payload: dict[str, Any]) -> None:
    """If ``GC_RUN_PLUGIN_MODULE`` is set, import it and call ``on_run_finished(payload)`` when defined."""
    name = os.environ.get("GC_RUN_PLUGIN_MODULE", "").strip()
    if not name:
        return
    try:
        mod = importlib.import_module(name)
    except Exception:
        _LOG.warning("GC_RUN_PLUGIN_MODULE import failed: %s", name, exc_info=True)
        return
    fn = getattr(mod, "on_run_finished", None)
    if not callable(fn):
        return
    try:
        fn(payload)
    except Exception:
        _LOG.warning("on_run_finished raised: %s", name, exc_info=True)
