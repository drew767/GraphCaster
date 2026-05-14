# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from graph_caster.nodes.prompt_concat import execute_prompt_concat


def _make_ctx(node_outputs: dict | None = None) -> dict:
    return {"node_outputs": node_outputs or {}}


def _emit_capture() -> tuple[list, object]:
    events: list[tuple[str, dict]] = []

    def emit(name: str, **kwargs: object) -> None:
        events.append((name, dict(kwargs)))

    return events, emit


def test_basic_concat_two_slots() -> None:
    events, emit = _emit_capture()
    ctx = _make_ctx(
        {
            "n_title": {"processResult": {"stdout": "GraphCaster"}},
            "n_rag": {"processResult": {"passages": "Passage A. Passage B."}},
        }
    )
    ok, patch = execute_prompt_concat(
        node_id="concat1",
        graph_id="g1",
        data={
            "template": "Summarize: {{topic}}\n\nReference:\n{{context}}",
            "slots": {
                "topic": '$node["n_title"].json.processResult.stdout',
                "context": '$node["n_rag"].json.processResult.passages',
            },
        },
        ctx=ctx,
        emit=emit,
    )
    assert ok is True
    assert "promptConcatResult" in patch
    text = patch["promptConcatResult"]["text"]
    assert "GraphCaster" in text
    assert "Passage A. Passage B." in text
    assert "Summarize:" in text
    assert "Reference:" in text
    names = [e[0] for e in events]
    assert "process_complete" in names


def test_missing_slot_in_template_renders_literal() -> None:
    events, emit = _emit_capture()
    ctx = _make_ctx()
    ok, patch = execute_prompt_concat(
        node_id="concat2",
        graph_id="g1",
        data={
            "template": "Hello {{name}}, your score is {{score}}.",
            "slots": {
                "name": '"Alice"',
            },
        },
        ctx=ctx,
        emit=emit,
    )
    assert ok is True
    text = patch["promptConcatResult"]["text"]
    assert "Alice" in text
    assert "{{score}}" in text


def test_slot_expression_nonexistent_node_returns_empty_and_warns() -> None:
    events, emit = _emit_capture()
    ctx = _make_ctx()
    ok, patch = execute_prompt_concat(
        node_id="concat3",
        graph_id="g1",
        data={
            "template": "Data: {{val}}",
            "slots": {
                "val": '$node["ghost_node"].json.output',
            },
        },
        ctx=ctx,
        emit=emit,
    )
    assert ok is True
    text = patch["promptConcatResult"]["text"]
    assert text == "Data: "
    warning_events = [e for e in events if e[0] == "node_warning"]
    assert len(warning_events) > 0


def test_empty_slots_renders_template_as_is() -> None:
    events, emit = _emit_capture()
    ctx = _make_ctx()
    ok, patch = execute_prompt_concat(
        node_id="concat4",
        graph_id="g1",
        data={
            "template": "Just a plain string.",
            "slots": {},
        },
        ctx=ctx,
        emit=emit,
    )
    assert ok is True
    assert patch["promptConcatResult"]["text"] == "Just a plain string."


def test_slot_with_mustache_wrapper_in_expression() -> None:
    events, emit = _emit_capture()
    ctx = _make_ctx({"src": {"val": "hello"}})
    ok, patch = execute_prompt_concat(
        node_id="concat5",
        graph_id="g1",
        data={
            "template": "{{greeting}}",
            "slots": {
                "greeting": '{{ $node["src"].json.val }}',
            },
        },
        ctx=ctx,
        emit=emit,
    )
    assert ok is True
    assert patch["promptConcatResult"]["text"] == "hello"


def test_last_result_set_to_rendered_text() -> None:
    events, emit = _emit_capture()
    ctx = _make_ctx()
    execute_prompt_concat(
        node_id="concat6",
        graph_id="g1",
        data={"template": "fixed text", "slots": {}},
        ctx=ctx,
        emit=emit,
    )
    assert ctx["last_result"] == "fixed text"
