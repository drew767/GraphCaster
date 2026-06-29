# Copyright GraphCaster. All Rights Reserved.

"""Unit tests for runner.dispatch_tables.

These tests pin the two contracts that the main loop now relies on:

* every node-type registered in ``REDACT_BY_TYPE`` is also a known type
  (no orphans pointing at non-existent types);
* every node-type that the runner can dispatch to (``VISIT_BY_TYPE``) plus the
  control-flow types listed in ``CONTROL_FLOW_TYPES`` together cover the full
  baseline catalog ``node_registry._BUILTIN_V1_TYPES`` — no type silently
  falls through both dispatch and the inline if/elif tail.
"""

from __future__ import annotations

from graph_caster.node_registry import _BUILTIN_V1_TYPES
from graph_caster.runner.dispatch_tables import (
    REDACT_BY_TYPE,
    VISIT_BY_TYPE,
    apply_redact,
)


# Node types whose execution is handled inline in GraphRunner._run_from_execution_phase
# (and intentionally NOT routed through VISIT_BY_TYPE). Keep this list in sync with the
# elif-chain after the dispatch_visit() call in the runner.
CONTROL_FLOW_TYPES: frozenset[str] = frozenset(
    {
        "start",        # entry point — no per-type body
        "exit",         # terminal — emits run_success
        "fork",         # branching — handled post-visit
        "merge",        # join — barrier accounting via outs_map setup
        "ai_route",     # LLM-driven routing — handled post-visit
        "graph_ref",    # inline self._execute_graph_ref
        "mcp_tool",     # inline self._execute_mcp_tool
        "human_input",  # inline self._run_human_input_visit
        "comment",      # editor-frame; is_editor_frame_node_type → skip
        "group",        # editor-frame; is_editor_frame_node_type → skip
        "trigger_error", # post-run error handler — not main-loop dispatched
        "prompt_concat", # composition primitive — passthrough
        "api_call",      # post-loop trigger — passthrough
    }
)


class TestRedactByType:
    def test_no_orphans_pointing_at_unknown_types(self) -> None:
        unknown = set(REDACT_BY_TYPE) - set(_BUILTIN_V1_TYPES)
        assert unknown == set(), f"REDACT_BY_TYPE has unknown types: {unknown}"

    def test_apply_redact_is_identity_for_unknown_type(self) -> None:
        data = {"foo": "bar"}
        out = apply_redact("definitely_not_a_real_node_type", data)
        assert out is data, "identity passthrough must not clone for unknown types"

    def test_apply_redact_returns_dict_for_known_types(self) -> None:
        for node_type in REDACT_BY_TYPE:
            out = apply_redact(node_type, {"safe": "value"})
            assert isinstance(out, dict), f"{node_type}: redact must return dict"

    def test_redact_functions_are_callable(self) -> None:
        for node_type, fn in REDACT_BY_TYPE.items():
            assert callable(fn), f"REDACT_BY_TYPE[{node_type!r}] is not callable"


class TestVisitByType:
    def test_no_orphans_pointing_at_unknown_types(self) -> None:
        unknown = set(VISIT_BY_TYPE) - set(_BUILTIN_V1_TYPES)
        assert unknown == set(), f"VISIT_BY_TYPE has unknown types: {unknown}"

    def test_visit_functions_are_callable(self) -> None:
        for node_type, fn in VISIT_BY_TYPE.items():
            assert callable(fn), f"VISIT_BY_TYPE[{node_type!r}] is not callable"

    def test_dispatch_or_control_flow_covers_all_baseline_types(self) -> None:
        covered = set(VISIT_BY_TYPE) | CONTROL_FLOW_TYPES
        missing = set(_BUILTIN_V1_TYPES) - covered
        assert missing == set(), (
            f"node types neither in VISIT_BY_TYPE nor CONTROL_FLOW_TYPES: {missing}"
        )

    def test_visit_and_control_flow_are_disjoint(self) -> None:
        overlap = set(VISIT_BY_TYPE) & CONTROL_FLOW_TYPES
        assert overlap == set(), (
            f"types must be in VISIT_BY_TYPE xor CONTROL_FLOW_TYPES, not both: {overlap}"
        )
