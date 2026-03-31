# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Callable

_LOG = logging.getLogger(__name__)

RunFinishedHook = Callable[[dict[str, Any], Path | None], None]

_hooks: list[RunFinishedHook] = []


def register_run_finished_hook(fn: RunFinishedHook) -> None:
    _hooks.append(fn)


def reset_run_finished_hooks() -> None:
    _hooks.clear()


def dispatch_run_finished_audit(payload: dict[str, Any], *, workspace_root: Path | None) -> None:
    for fn in list(_hooks):
        try:
            fn(payload, workspace_root)
        except Exception:
            _LOG.debug("audit hook failure", exc_info=True)
