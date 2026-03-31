# Copyright GraphCaster. All Rights Reserved.

"""Append-only JSONL audit log (optional, Phase 6.2 minimal)."""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

_LOG = logging.getLogger(__name__)


def append_run_finished_audit_maybe(payload: dict[str, Any], *, workspace_root: Path | None) -> None:
    """Append one JSON line if ``GC_AUDIT_LOG_PATH`` is set, or if ``GC_AUDIT_LOG_AUTO=1`` and *workspace_root* is set (file: ``<workspace>/.graphcaster/run_audit.jsonl``).

    Always dispatches :func:`dispatch_run_finished_audit` for host hooks (even when no JSONL path applies).
    """
    explicit = os.environ.get("GC_AUDIT_LOG_PATH", "").strip()
    auto = os.environ.get("GC_AUDIT_LOG_AUTO", "").strip() == "1"
    path: Path | None
    if explicit:
        path = Path(explicit)
    elif auto and workspace_root is not None:
        path = Path(workspace_root) / ".graphcaster" / "run_audit.jsonl"
    else:
        path = None
    if path is not None:
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            line = json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"
            with path.open("a", encoding="utf-8") as f:
                f.write(line)
        except OSError:
            _LOG.debug("audit append failed: %s", path, exc_info=True)

    try:
        from graph_caster.audit.audit_hook import dispatch_run_finished_audit

        wr = Path(workspace_root).resolve() if workspace_root is not None else None
        dispatch_run_finished_audit(payload, workspace_root=wr)
    except Exception:
        _LOG.debug("audit hook dispatch failed", exc_info=True)
