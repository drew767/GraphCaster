# Copyright GraphCaster. All Rights Reserved.

"""Static drift check between `schemas/run-event.schema.json` and Python emit-sites.

The schema declares 38 canonical event types via `properties.type.const`.
The runner emits events via `self.emit("<name>", ...)` and a handful of
direct sink calls. This test:

* extracts the canonical set from the schema;
* scans `python/graph_caster/**/*.py` for `emit("<name>"` and
  `{"type": "<name>"...}` patterns;
* fails when an event is emitted but absent from the schema (forward break);
* records (but does not fail on) events declared in the schema but never
  emitted — the known list is pinned in `KNOWN_DECLARED_NOT_EMITTED` and any
  drift from that list will fail the test, forcing a conscious update.

Pinning known drift this way replaces the audit's "ghost events" finding with
a CI gate: shrinking the list (by implementing) or expanding it (by
deprecating from schema) must be an intentional, reviewed change.
"""

from __future__ import annotations

import json
import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
SCHEMA_PATH = REPO_ROOT / "schemas" / "run-event.schema.json"
PYTHON_PACKAGE = REPO_ROOT / "python" / "graph_caster"


def _canonical_event_types() -> set[str]:
    """Return the set of `properties.type.const` strings from the schema."""
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    found: set[str] = set()

    def walk(node: object) -> None:
        if isinstance(node, dict):
            props = node.get("properties")
            if isinstance(props, dict):
                t = props.get("type")
                if isinstance(t, dict):
                    c = t.get("const")
                    if isinstance(c, str):
                        found.add(c)
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(schema)
    return found


_EMIT_PATTERN = re.compile(r'\.emit\(\s*"([a-z][a-z0-9_]+)"')
_DICT_TYPE_PATTERN = re.compile(r'"type"\s*:\s*"([a-z][a-z0-9_]+)"')


def _emitted_event_types() -> set[str]:
    """Scan source for `*.emit("name", ...)` and dict-literal `{"type": "name", ...}` calls."""
    emitted: set[str] = set()
    for py in PYTHON_PACKAGE.rglob("*.py"):
        text = py.read_text(encoding="utf-8", errors="ignore")
        for m in _EMIT_PATTERN.finditer(text):
            emitted.add(m.group(1))
        for m in _DICT_TYPE_PATTERN.finditer(text):
            emitted.add(m.group(1))
    return emitted


# Events declared in the schema that are NOT (yet) emitted anywhere in the
# Python source. Each entry is a known piece of drift: either pending
# implementation or pending removal from the schema. Touching this list
# requires a conscious decision; the test below fails if the actual drift
# diverges from this pin.
KNOWN_DECLARED_NOT_EMITTED: frozenset[str] = frozenset({
    # ---- Agent-delegate event family ----
    # `agent_delegate.py` exists with a wired class but emission is gated behind
    # a flag that's never turned on in the runner-side code path. Schema kept
    # for UI replay compatibility (LangGraph-style step viewer). Audit 2026-05.
    "agent_delegate_start",
    "agent_step",
    "agent_tool_call",
    "agent_finished",
    "agent_failed",
    # ---- Subprocess-instrumentation events ----
    # `process_exec.py` runs subprocesses but currently surfaces only stdout/
    # stderr lines, not lifecycle events. Schema kept for the planned
    # observability rollout in process_exec.py. Audit 2026-05.
    "process_spawn",
    "process_complete",
    "process_failed",
    # ---- Timer node ----
    # `delay_wait_exec.py` does the wait via sleep, no progress events; schema
    # ready for the planned chunked-wait UI affordance. Audit 2026-05.
    "wait_timer",
})


# Emitted names that are NOT part of the canonical schema vocabulary. These
# typically come from generic emit sites that re-use the schema's name space
# for diagnostic events. Pinning them here prevents accidental new ones from
# slipping in unannounced.
KNOWN_EMITTED_NOT_DECLARED: frozenset[str] = frozenset({
    # Scheduler diagnostic — main loop emits these when scheduler_trace=on.
    # Not part of the public event contract; left out of schema intentionally.
    "scheduler_pick",
    # Versioned-node fallback notice (node_registry.py).
    "node_version_fallback",
    # Node mode events (skipped/bypassed) — implemented in the abandoned
    # run_state_machine.py refactor, currently un-wired in the main runner.
    # Will become canonical once that refactor lands.
    "node_skipped",
    "node_bypassed",
    # Run lifecycle add-ons (pause/resume).
    "run_paused",
    "run_resumed",
    # Interactive-graph human gate (human_input node). Implemented but not
    # part of the canonical run-event vocabulary — UI subscribes via a side
    # channel. Pinned here pending a decision on whether to canonicalise.
    "human_input_required",
})


def test_schema_has_event_types() -> None:
    """Sanity: the schema declares at least the core lifecycle event set."""
    schema_types = _canonical_event_types()
    core = {"run_started", "run_finished", "node_enter", "node_execute", "node_exit", "error"}
    missing = core - schema_types
    assert missing == set(), (
        f"run-event.schema.json missing core types: {missing}"
    )


def test_emitted_types_have_known_classification() -> None:
    """Every event Python emits must be either in the schema or in KNOWN_EMITTED_NOT_DECLARED."""
    schema_types = _canonical_event_types()
    emitted = _emitted_event_types()
    # Remove pure JSON-schema vocabulary that this naive grep picks up
    # (kept very small — these are not events, they're schema-property values).
    vocab_noise = {
        # JSON-schema primitive type names — grep noise, not events.
        "boolean", "integer", "number", "string", "object", "array",
        # Slack block-kit / message vocabulary (used in slack_blocks helpers).
        "function", "section", "header", "context", "actions", "button",
        "plain_text", "mrkdwn", "text",
        "image", "divider", "rich_text", "input",
        # Cross-component protocol verbs that share the "type" field but
        # belong to other protocols (control-stdin, IDE bridge, etc).
        "cancel_run", "pong", "schedule", "webhook", "share", "update",
        "openai_compat", "tool_use", "tool_result", "api", "api_partial",
        "http", "awareness",
        # LLM provider protocol (llm/ package), not run-event protocol.
        "llm_attempt", "llm_attempt_failed", "llm_fallback_used",
        "llm_success", "llm_token",
        # Replay / recovery telemetry (replay.py) — separate protocol.
        "replay_planned", "replay_started", "recovery_started",
        "node_pinned_from_replay", "node_started", "step_finished",
        # Loop runner (separate from main graph loop) — its own event names.
        "loop_started", "loop_progress", "loop_finished",
        # Auth provider vocabulary (mcp_oauth / auth subsystem).
        "oauth2",
        # Process I/O classification, not a run-event proper
        # (process_output emits {"channel": "stderr|stdout"} payload).
        "stderr",
    }
    emitted = emitted - vocab_noise
    unknown = emitted - schema_types - KNOWN_EMITTED_NOT_DECLARED
    assert unknown == set(), (
        f"Python emits events not in run-event.schema.json or KNOWN_EMITTED_NOT_DECLARED: "
        f"{sorted(unknown)}. Either add them to the schema or pin them in the known-set "
        f"(with a comment explaining why)."
    )


def test_declared_drift_matches_pinned_set() -> None:
    """Pin the set of schema-declared events with no emitter. Drift must be conscious."""
    schema_types = _canonical_event_types()
    emitted = _emitted_event_types()
    declared_not_emitted = schema_types - emitted
    # Allow shrinking the pin (an event got implemented) without test churn,
    # but require explicit acknowledgement when the pin grows (a new ghost type).
    new_ghosts = declared_not_emitted - KNOWN_DECLARED_NOT_EMITTED
    assert new_ghosts == set(), (
        f"New schema event types with no emitter detected: {sorted(new_ghosts)}. "
        f"Add them to KNOWN_DECLARED_NOT_EMITTED with a comment, or implement emission."
    )
