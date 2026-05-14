# Copyright GraphCaster. All Rights Reserved.

"""Tests for ai_builder.builder (F91)."""

from __future__ import annotations

import json
from typing import Any

import pytest

from graph_caster.ai_builder import AIWorkflowBuilder, BuildResult
from graph_caster.llm.provider import ChatMessage, ChatResponse, ModelProvider, TokenUsage
from graph_caster.llm.registry import ProviderRegistry


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_VALID_GRAPH = {
    "schemaVersion": 1,
    "meta": {"graphId": "test-graph-001", "title": "Send Slack message"},
    "nodes": [
        {"id": "s1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
        {
            "id": "slack",
            "type": "task",
            "position": {"x": 150, "y": 0},
            "data": {"command": "slack", "argv": ["send", "--channel", "#general"]},
        },
        {"id": "x1", "type": "exit", "position": {"x": 300, "y": 0}, "data": {}},
    ],
    "edges": [
        {"id": "e1", "source": "s1", "target": "slack", "sourceHandle": "out_default", "targetHandle": "in_default"},
        {"id": "e2", "source": "slack", "target": "x1", "sourceHandle": "out_default", "targetHandle": "in_default"},
    ],
}

_INVALID_GRAPH = {
    "schemaVersion": 1,
    "meta": {"graphId": "bad-graph-001"},
    "nodes": [
        {"id": "t1", "type": "task", "position": {"x": 0, "y": 0}, "data": {}},
    ],
    "edges": [],
}

_VALID_LLM_RESPONSE = json.dumps(
    {"graph": _VALID_GRAPH, "rationale": "Simple start->task->exit for Slack message."}
)

_INVALID_LLM_RESPONSE = json.dumps(
    {
        "graph": _INVALID_GRAPH,
        "rationale": "Missing start and exit nodes intentionally for test.",
    }
)


def _make_response(content: str, prompt_tokens: int = 100, completion_tokens: int = 200) -> ChatResponse:
    return ChatResponse(
        content=content,
        usage=TokenUsage(
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=prompt_tokens + completion_tokens,
        ),
        finish_reason="stop",
    )


def _make_registry(responses: list[str]) -> ProviderRegistry:
    """Build a ProviderRegistry with a mock provider that returns responses in sequence."""
    call_count = [0]

    class MockProvider(ModelProvider):
        name = "mock"

        async def chat(self, model: str, messages: list, **kwargs: Any) -> ChatResponse:
            idx = call_count[0]
            call_count[0] += 1
            content = responses[idx] if idx < len(responses) else responses[-1]
            return _make_response(content)

        async def list_models(self) -> list[str]:
            return ["mock-model"]

    reg = ProviderRegistry()
    reg.register(MockProvider())
    return reg


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

@pytest.mark.anyio
async def test_build_slack_message_returns_valid_graph() -> None:
    reg = _make_registry([_VALID_LLM_RESPONSE])
    builder = AIWorkflowBuilder(provider="mock", model="mock-model", registry=reg)
    result = await builder.build("Send Slack message after run")

    assert isinstance(result, BuildResult)
    assert result.graph.get("schemaVersion") == 1
    assert result.validation_errors == [], f"Unexpected errors: {result.validation_errors}"
    assert result.rationale != ""
    assert "mock" in result.tokens_used


@pytest.mark.anyio
async def test_tokens_used_populated() -> None:
    reg = _make_registry([_VALID_LLM_RESPONSE])
    builder = AIWorkflowBuilder(provider="mock", model="mock-model", registry=reg)
    result = await builder.build("any description")

    assert result.tokens_used["mock"]["input"] == 100
    assert result.tokens_used["mock"]["output"] == 200
    assert result.tokens_used["mock"]["total"] == 300


@pytest.mark.anyio
async def test_invalid_json_from_llm_populates_validation_errors() -> None:
    """If LLM returns invalid JSON, validation_errors should be populated."""
    reg = _make_registry(["not valid json at all"])
    builder = AIWorkflowBuilder(provider="mock", model="mock-model", registry=reg)
    result = await builder.build("something", refine_iterations=0)

    assert result.validation_errors != []
    assert any("parse" in e.lower() or "json" in e.lower() for e in result.validation_errors)
    assert result.graph == {}


@pytest.mark.anyio
async def test_invalid_graph_from_llm_populates_validation_errors() -> None:
    """If LLM returns valid JSON but invalid graph, validation_errors should be populated."""
    reg = _make_registry([_INVALID_LLM_RESPONSE])
    builder = AIWorkflowBuilder(provider="mock", model="mock-model", registry=reg)
    result = await builder.build("something", refine_iterations=0)

    assert result.validation_errors != []


@pytest.mark.anyio
async def test_refine_iterations_2_first_invalid_second_valid() -> None:
    """With refine_iterations=2, first call returns invalid graph, second returns valid."""
    reg = _make_registry([_INVALID_LLM_RESPONSE, _VALID_LLM_RESPONSE])
    builder = AIWorkflowBuilder(provider="mock", model="mock-model", registry=reg)
    result = await builder.build("something", refine_iterations=2)

    assert result.validation_errors == [], f"Should be valid after refinement; got: {result.validation_errors}"
    assert result.rationale != ""


@pytest.mark.anyio
async def test_refine_iterations_0_no_retry_on_invalid() -> None:
    """With refine_iterations=0, does not retry even if graph is invalid."""
    reg = _make_registry([_INVALID_LLM_RESPONSE])
    builder = AIWorkflowBuilder(provider="mock", model="mock-model", registry=reg)
    result = await builder.build("something", refine_iterations=0)

    assert result.validation_errors != []


@pytest.mark.anyio
async def test_tokens_accumulated_across_refinement() -> None:
    """Tokens from both calls should accumulate."""
    reg = _make_registry([_INVALID_LLM_RESPONSE, _VALID_LLM_RESPONSE])
    builder = AIWorkflowBuilder(provider="mock", model="mock-model", registry=reg)
    result = await builder.build("something", refine_iterations=1)

    total_input = result.tokens_used["mock"]["input"]
    assert total_input == 200, f"Expected 2 * 100 = 200, got {total_input}"


@pytest.mark.anyio
async def test_refine_modifies_existing_graph() -> None:
    """refine() with valid response returns a valid BuildResult."""
    reg = _make_registry([_VALID_LLM_RESPONSE])
    builder = AIWorkflowBuilder(provider="mock", model="mock-model", registry=reg)
    result = await builder.refine(_VALID_GRAPH, "Also include closed issues")

    assert isinstance(result, BuildResult)
    assert result.graph.get("schemaVersion") == 1
    assert result.validation_errors == []


@pytest.mark.anyio
async def test_refine_with_invalid_response_populates_errors() -> None:
    reg = _make_registry(["invalid json"])
    builder = AIWorkflowBuilder(provider="mock", model="mock-model", registry=reg)
    result = await builder.refine(_VALID_GRAPH, "add something")

    assert result.validation_errors != []
    assert result.graph == {}


@pytest.mark.anyio
async def test_available_nodes_passed_through() -> None:
    """available_nodes list should be accepted without error."""
    reg = _make_registry([_VALID_LLM_RESPONSE])
    builder = AIWorkflowBuilder(provider="mock", model="mock-model", registry=reg)
    result = await builder.build(
        "Send Slack message",
        available_nodes=["start", "task", "exit"],
    )
    assert isinstance(result, BuildResult)


@pytest.mark.anyio
async def test_custom_examples_used() -> None:
    """Custom examples parameter is accepted without error."""
    custom_example = {
        "schemaVersion": 1,
        "nodes": [
            {"id": "s", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {"id": "x", "type": "exit", "position": {"x": 100, "y": 0}, "data": {}},
        ],
        "edges": [{"id": "e1", "source": "s", "target": "x"}],
    }
    reg = _make_registry([_VALID_LLM_RESPONSE])
    builder = AIWorkflowBuilder(provider="mock", model="mock-model", registry=reg)
    result = await builder.build("something", examples=[custom_example])
    assert isinstance(result, BuildResult)
