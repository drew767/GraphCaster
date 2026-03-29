# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
from unittest.mock import MagicMock

from graph_caster.agent_delegate import (
    AgentDelegateRuntimeState,
    apply_agent_delegate_stdout_line,
    build_llm_agent_stdin_text,
    parse_agent_stdout_line_test_hook,
)


def test_build_llm_agent_stdin_includes_node_and_truncation_guard() -> None:
    big = {"x": "y" * 200_000}
    text = build_llm_agent_stdin_text(
        graph_id="g1",
        node_id="n1",
        run_id="r1",
        upstream_outputs=big,
        input_payload=None,
        max_utf8_bytes=4096,
    )
    line = text.strip()
    assert len(line.encode("utf-8")) <= 4096
    obj = json.loads(line)
    assert obj.get("schemaVersion") == 1
    assert obj.get("graphId") == "g1"
    assert obj.get("nodeId") == "n1"


def test_apply_stdout_parses_ndjson_and_finishes() -> None:
    state = AgentDelegateRuntimeState()
    proc = MagicMock()
    emitted: list[tuple[str, dict]] = []

    def emit(etype: str, **kw: object) -> None:
        emitted.append((etype, kw))

    apply_agent_delegate_stdout_line(
        '{"type":"agent_step","phase":"llm","message":"x"}',
        state,
        node_id="n1",
        graph_id="g1",
        emit=emit,
        max_steps=0,
        proc=proc,
    )
    assert state.step_count == 1
    assert not state.finished

    apply_agent_delegate_stdout_line(
        '{"type":"agent_finished","result":{"answer":1}}',
        state,
        node_id="n1",
        graph_id="g1",
        emit=emit,
        max_steps=0,
        proc=proc,
    )
    assert state.finished
    assert state.success
    assert state.result == {"answer": 1}
    assert any(e[0] == "agent_finished" for e in emitted)


def test_bad_json_line_recorded_not_fatal() -> None:
    state = AgentDelegateRuntimeState()
    proc = MagicMock()

    apply_agent_delegate_stdout_line(
        "not-json{",
        state,
        node_id="n1",
        graph_id="g1",
        emit=lambda *_a, **_k: None,
        max_steps=0,
        proc=proc,
    )
    assert not state.finished
    assert len(state.bad_lines) == 1


def test_parse_hook_unknown_type() -> None:
    t, _p, err = parse_agent_stdout_line_test_hook('{"type":"nope"}')
    assert t is None
    assert err == "unknown_type"


def test_stdout_ignored_after_agent_finished() -> None:
    state = AgentDelegateRuntimeState()
    proc = MagicMock()
    emitted: list[tuple[str, dict]] = []

    def emit(etype: str, **kw: object) -> None:
        emitted.append((etype, kw))

    apply_agent_delegate_stdout_line(
        '{"type":"agent_finished","result":{"done":true}}',
        state,
        node_id="n1",
        graph_id="g1",
        emit=emit,
        max_steps=0,
        proc=proc,
    )
    n = len(emitted)
    apply_agent_delegate_stdout_line(
        '{"type":"agent_step","phase":"late","message":"ignored"}',
        state,
        node_id="n1",
        graph_id="g1",
        emit=emit,
        max_steps=0,
        proc=proc,
    )
    apply_agent_delegate_stdout_line(
        "not-json-after-finish",
        state,
        node_id="n1",
        graph_id="g1",
        emit=emit,
        max_steps=0,
        proc=proc,
    )
    assert len(emitted) == n
    assert len(state.bad_lines) == 0


def test_apply_stdout_strips_unknown_emit_keys() -> None:
    state = AgentDelegateRuntimeState()
    proc = MagicMock()
    emitted: list[tuple[str, dict]] = []

    def emit(etype: str, **kw: object) -> None:
        emitted.append((etype, kw))

    apply_agent_delegate_stdout_line(
        '{"type":"agent_step","phase":"x","evil":1,"nested":{"a":2}}',
        state,
        node_id="n1",
        graph_id="g1",
        emit=emit,
        max_steps=0,
        proc=proc,
        attempt=2,
    )
    ev = emitted[-1]
    assert ev[0] == "agent_step"
    assert ev[1].get("phase") == "x"
    assert ev[1].get("attempt") == 2
    assert "evil" not in ev[1]
    assert "nested" not in ev[1]
