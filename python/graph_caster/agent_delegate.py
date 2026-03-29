# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass, field
from typing import Any, Callable

EmitFn = Callable[..., None]

MAX_LLM_AGENT_STDIN_UTF8_BYTES = 256 * 1024

_AGENT_STDOUT_TYPES = frozenset(
    {
        "agent_delegate_start",
        "agent_step",
        "agent_tool_call",
        "agent_finished",
        "agent_failed",
    }
)

# Whitelist forwarded keys to ``emit`` (align with ``schemas/run-event.schema.json``).
_AGENT_EMIT_ALLOWED: dict[str, frozenset[str]] = {
    "agent_delegate_start": frozenset({"model", "message"}),
    "agent_step": frozenset({"phase", "message", "step"}),
    "agent_tool_call": frozenset({"toolName", "arguments"}),
    "agent_finished": frozenset({"result"}),
    "agent_failed": frozenset({"message"}),
}


def _emit_payload_for_agent_line(event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    allowed = _AGENT_EMIT_ALLOWED.get(event_type)
    if not allowed:
        return {}
    return {k: v for k, v in payload.items() if k in allowed}


@dataclass
class AgentDelegateRuntimeState:
    step_count: int = 0
    finished: bool = False
    success: bool = False
    result: Any = None
    fail_message: str | None = None
    bad_lines: list[str] = field(default_factory=list)


def _utf8_len(s: str) -> int:
    return len(s.encode("utf-8"))


def build_llm_agent_stdin_text(
    *,
    graph_id: str,
    node_id: str,
    run_id: str | None,
    upstream_outputs: dict[str, Any],
    input_payload: Any | None,
    max_utf8_bytes: int = MAX_LLM_AGENT_STDIN_UTF8_BYTES,
) -> str:
    """Single JSON line written to the delegated process stdin (UTF-8)."""

    def dumps_compact(obj: Any) -> str:
        return json.dumps(obj, ensure_ascii=False, default=str, separators=(",", ":"))

    base: dict[str, Any] = {
        "schemaVersion": 1,
        "graphId": graph_id,
        "nodeId": node_id,
        "runId": run_id or "",
        "upstreamOutputs": upstream_outputs,
    }
    if input_payload is not None:
        base["inputPayload"] = input_payload

    def fits(obj: dict[str, Any]) -> bool:
        return _utf8_len(dumps_compact(obj) + "\n") <= max_utf8_bytes

    if not fits(base):
        base["upstreamOutputs"] = {"_truncated": True, "reason": "payload_size_cap"}
        if "inputPayload" in base:
            del base["inputPayload"]
    if not fits(base):
        base["upstreamOutputs"] = {}
        if "inputPayload" in base:
            del base["inputPayload"]
    if not fits(base):
        base = {
            "schemaVersion": 1,
            "graphId": graph_id,
            "nodeId": node_id,
            "runId": run_id or "",
            "upstreamOutputs": {},
        }

    return dumps_compact(base) + "\n"


def apply_agent_delegate_stdout_line(
    line: str,
    state: AgentDelegateRuntimeState,
    *,
    node_id: str,
    graph_id: str,
    emit: EmitFn,
    max_steps: int,
    proc: subprocess.Popen[str],
    attempt: int = 0,
) -> None:
    """Parse one NDJSON line from the child; emit GraphCaster run events; update ``state``."""

    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        tail = line if len(line) <= 480 else line[:477] + "..."
        state.bad_lines.append(tail)
        return

    if not isinstance(obj, dict):
        state.bad_lines.append(line[:480])
        return

    raw_type = obj.get("type")
    if not isinstance(raw_type, str) or raw_type not in _AGENT_STDOUT_TYPES:
        state.bad_lines.append(line[:480])
        return

    payload = {k: v for k, v in obj.items() if k != "type"}
    payload.pop("nodeId", None)
    payload.pop("graphId", None)

    safe = _emit_payload_for_agent_line(raw_type, payload)
    emit(raw_type, nodeId=node_id, graphId=graph_id, attempt=attempt, **safe)

    if raw_type == "agent_step":
        state.step_count += 1
        if max_steps > 0 and state.step_count > max_steps:
            try:
                proc.kill()
            except OSError:
                pass

    elif raw_type == "agent_finished":
        state.finished = True
        state.success = True
        state.result = obj.get("result")

    elif raw_type == "agent_failed":
        state.finished = True
        state.success = False
        msg = obj.get("message")
        state.fail_message = str(msg) if msg is not None else "agent_failed"


def parse_agent_stdout_line_test_hook(
    line: str,
) -> tuple[str | None, dict[str, Any] | None, str | None]:
    """Test helper: returns (event_type, payload_without_type, error)."""
    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        return None, None, "json"
    if not isinstance(obj, dict):
        return None, None, "not_object"
    raw_type = obj.get("type")
    if not isinstance(raw_type, str) or raw_type not in _AGENT_STDOUT_TYPES:
        return None, None, "unknown_type"
    rest = {k: v for k, v in obj.items() if k != "type"}
    return raw_type, rest, None
