"""Shared helpers for cli/ command modules.

MUST NOT:
- Import from graph_caster.cli.commands.* (commands depend on helpers, not the inverse).
- Hold mutable module-level state.
"""
from __future__ import annotations

import copy
import json
import os
import sys
import threading
from pathlib import Path

from graph_caster.nested_run_subprocess import NESTED_CONTEXT_INPUT_KEYS
from graph_caster.run_sessions import RunSessionRegistry


def spawn_stdin_cancel_loop(registry: RunSessionRegistry) -> None:
    def loop() -> None:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as exc:
                if os.environ.get("GC_CONTROL_STDIN_DEBUG", "").strip():
                    print(f"graph-caster: control-stdin JSON skip: {exc}", file=sys.stderr, flush=True)
                continue
            if obj.get("type") != "cancel_run":
                continue
            rid = obj.get("runId") if "runId" in obj else obj.get("run_id")
            if rid is not None and str(rid).strip():
                registry.request_cancel(str(rid).strip())

    threading.Thread(target=loop, daemon=True).start()


def merge_context_json(ctx: dict, path: Path) -> None:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("context-json root must be a JSON object")
    outs = raw.get("node_outputs")
    if isinstance(outs, dict):
        bucket = ctx.setdefault("node_outputs", {})
        bucket.update(copy.deepcopy(outs))
    for k in NESTED_CONTEXT_INPUT_KEYS:
        if k == "node_outputs":
            continue
        if k in raw:
            ctx[k] = copy.deepcopy(raw[k])


def parse_scope_key(ref: str) -> tuple[str, str]:
    """Split 'scope.name' into (scope, name). Raises ValueError on bad format."""
    parts = ref.split(".", 1)
    if len(parts) != 2 or not parts[0] or not parts[1]:
        raise ValueError(f"Variable reference must be scope.name, got: {ref!r}")
    return parts[0], parts[1]


def parse_version_arg(raw: str) -> int | None:
    """Convert 'draft' or an integer string to int | None."""
    if raw.strip().lower() == "draft":
        return None
    try:
        return int(raw)
    except ValueError:
        raise ValueError(f"version must be an integer or 'draft', got: {raw!r}")
