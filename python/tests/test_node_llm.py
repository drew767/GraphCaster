# Copyright GraphCaster. All Rights Reserved.

"""Tests for F51 LLMNode."""

from __future__ import annotations

import os
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from graph_caster.llm.provider import ChatResponse, ChatStreamChunk, TokenUsage, ToolCall
from graph_caster.llm.registry import ProviderRegistry
from graph_caster.llm.usage import UsageTracker
from graph_caster.node_api import register_class
from graph_caster.nodes.llm import LLMNode


# ── helpers ──────────────────────────────────────────────────────────────────


def _make_ctx(
    *,
    node_id: str = "llm1",
    run_id: str = "run-test",
    emit=None,
    upstream_outputs: dict | None = None,
    usage_tracker=None,
    expression_eval=None,
) -> Any:
    ctx = MagicMock()
    ctx.node_id = node_id
    ctx.run_id = run_id
    ctx.emit = emit or MagicMock()
    ctx.upstream_outputs = upstream_outputs or {}
    if usage_tracker is not None:
        ctx.usage_tracker = usage_tracker
    else:
        del ctx.usage_tracker
    if expression_eval is not None:
        ctx.expression_eval = expression_eval
    else:
        del ctx.expression_eval
    return ctx


def _fake_provider(name: str = "mock", response_content: str = "Hi") -> Any:
    provider = MagicMock()
    provider.name = name
    provider.chat = AsyncMock(
        return_value=ChatResponse(
            content=response_content,
            tool_calls=[],
            usage=TokenUsage(prompt_tokens=10, completion_tokens=5, total_tokens=15),
            finish_reason="stop",
        )
    )
    return provider


def _make_registry(provider: Any) -> ProviderRegistry:
    registry = ProviderRegistry()
    registry.register(provider)
    return registry


async def _run_node(node: LLMNode, ctx: Any, **kwargs: Any) -> dict:
    return await node.run(ctx, **kwargs)


# ── tests ─────────────────────────────────────────────────────────────────────


def test_llm_node_registered() -> None:
    from graph_caster.node_api import get_registered

    cls = get_registered("llm", 1.0)
    assert cls is LLMNode


@pytest.mark.anyio
async def test_happy_path_returns_content() -> None:
    provider = _fake_provider("openai", "Hi")
    registry = _make_registry(provider)
    node = LLMNode()
    ctx = _make_ctx()

    with patch("graph_caster.nodes.llm.get_default_registry", return_value=registry):
        result = await _run_node(
            node, ctx,
            provider="openai",
            model="gpt-4o",
            systemPrompt="You are helpful.",
            userPrompt="Hello",
            temperature=0.7,
            maxTokens=256,
            stream=False,
        )

    assert result["content"] == "Hi"
    assert result["toolCalls"] == []
    assert result["finishReason"] == "stop"
    assert result["usage"]["prompt_tokens"] == 10
    assert result["usage"]["completion_tokens"] == 5


@pytest.mark.anyio
async def test_tool_calls_passthrough() -> None:
    tool_call = ToolCall(id="tc1", name="search", arguments={"q": "weather"})
    provider = MagicMock()
    provider.name = "openai"
    provider.chat = AsyncMock(
        return_value=ChatResponse(
            content="",
            tool_calls=[tool_call],
            usage=TokenUsage(prompt_tokens=8, completion_tokens=3, total_tokens=11),
            finish_reason="tool_calls",
        )
    )
    registry = _make_registry(provider)
    node = LLMNode()
    ctx = _make_ctx()

    with patch("graph_caster.nodes.llm.get_default_registry", return_value=registry):
        result = await _run_node(
            node, ctx,
            provider="openai",
            model="gpt-4o",
            userPrompt="What's the weather?",
            tools=[{"type": "function", "function": {"name": "search"}}],
        )

    assert result["finishReason"] == "tool_calls"
    assert len(result["toolCalls"]) == 1
    assert result["toolCalls"][0]["name"] == "search"
    assert result["toolCalls"][0]["arguments"] == {"q": "weather"}


@pytest.mark.anyio
async def test_streaming_emits_llm_token_events() -> None:
    async def _fake_stream(*args, **kwargs):
        for chunk_text in ["Hello", " world", "!"]:
            yield ChatStreamChunk(delta=chunk_text)
        yield ChatStreamChunk(delta="", finish_reason="stop")

    provider = MagicMock()
    provider.name = "openai"

    async def _chat(model, messages, *, tools=None, temperature=None, max_tokens=None, stream=False):
        if stream:
            return _fake_stream()
        return ChatResponse(content="Hello world!", tool_calls=[], usage=TokenUsage(), finish_reason="stop")

    provider.chat = _chat

    registry = _make_registry(provider)
    emitted: list[dict] = []
    node = LLMNode()
    ctx = _make_ctx(emit=lambda e: emitted.append(e))

    with patch("graph_caster.nodes.llm.get_default_registry", return_value=registry):
        result = await _run_node(
            node, ctx,
            provider="openai",
            model="gpt-4o",
            userPrompt="Hello",
            stream=True,
        )

    assert result["content"] == "Hello world!"
    token_events = [e for e in emitted if e.get("type") == "llm_token"]
    assert len(token_events) == 3
    assert token_events[0]["content"] == "Hello"
    assert token_events[1]["content"] == " world"
    assert token_events[2]["content"] == "!"
    for ev in token_events:
        assert ev["nodeId"] == "llm1"
        assert ev["runId"] == "run-test"


@pytest.mark.anyio
async def test_fallback_chain_provider1_fails_provider2_succeeds() -> None:
    from graph_caster.llm.errors import LLMRateLimitError

    bad_provider = MagicMock()
    bad_provider.name = "openai"
    bad_provider.chat = AsyncMock(side_effect=LLMRateLimitError("rate limited"))

    good_provider = MagicMock()
    good_provider.name = "anthropic"
    good_provider.chat = AsyncMock(
        return_value=ChatResponse(
            content="Fallback answer",
            tool_calls=[],
            usage=TokenUsage(prompt_tokens=6, completion_tokens=4, total_tokens=10),
            finish_reason="stop",
        )
    )

    registry = ProviderRegistry()
    registry.register(bad_provider)
    registry.register(good_provider)

    node = LLMNode()
    ctx = _make_ctx()

    with patch("graph_caster.nodes.llm.get_default_registry", return_value=registry):
        result = await _run_node(
            node, ctx,
            provider="openai",
            model="gpt-4o",
            userPrompt="Will this fail?",
            fallback=[
                {"provider": "openai", "model": "gpt-4o"},
                {"provider": "anthropic", "model": "claude-sonnet-4"},
            ],
        )

    assert result["content"] == "Fallback answer"


@pytest.mark.anyio
async def test_mustache_expansion_in_prompts() -> None:
    provider = _fake_provider("openai", "Hi")
    registry = _make_registry(provider)
    node = LLMNode()

    upstream = {"upstream_node": {"text": "world"}}

    def expression_eval(template: str, context: dict) -> str:
        if "{{ $node.upstream_node.text }}" in template:
            return template.replace("{{ $node.upstream_node.text }}", "world")
        return template

    ctx = _make_ctx(upstream_outputs=upstream, expression_eval=expression_eval)

    captured_messages: list = []

    async def _chat(model, messages, *, tools=None, temperature=None, max_tokens=None, stream=False):
        captured_messages.extend(messages)
        return ChatResponse(
            content="Hi",
            tool_calls=[],
            usage=TokenUsage(prompt_tokens=10, completion_tokens=2, total_tokens=12),
            finish_reason="stop",
        )

    provider.chat = _chat

    with patch("graph_caster.nodes.llm.get_default_registry", return_value=registry):
        result = await _run_node(
            node, ctx,
            provider="openai",
            model="gpt-4o",
            systemPrompt="Hello {{ $node.upstream_node.text }}",
            userPrompt="Say {{ $node.upstream_node.text }}",
        )

    assert result["content"] == "Hi"
    assert len(captured_messages) == 2
    assert captured_messages[0].content == "Hello world"
    assert captured_messages[1].content == "Say world"


@pytest.mark.anyio
async def test_temperature_env_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("TEST_LLM_TEMP", "1.5")

    provider = MagicMock()
    provider.name = "openai"
    captured_kwargs: dict = {}

    async def _chat(model, messages, *, tools=None, temperature=None, max_tokens=None, stream=False):
        captured_kwargs["temperature"] = temperature
        return ChatResponse(
            content="ok",
            tool_calls=[],
            usage=TokenUsage(prompt_tokens=5, completion_tokens=2, total_tokens=7),
            finish_reason="stop",
        )

    provider.chat = _chat

    registry = _make_registry(provider)
    node = LLMNode()
    ctx = _make_ctx()

    with patch("graph_caster.nodes.llm.get_default_registry", return_value=registry):
        await _run_node(
            node, ctx,
            provider="openai",
            model="gpt-4o",
            userPrompt="Test",
            temperature=0.2,
            temperatureEnv="TEST_LLM_TEMP",
        )

    assert captured_kwargs["temperature"] == pytest.approx(1.5)


@pytest.mark.anyio
async def test_usage_recorded_via_usage_tracker() -> None:
    provider = _fake_provider("openai", "Response")
    registry = _make_registry(provider)
    node = LLMNode()
    tracker = UsageTracker(run_id="test-run-usage")
    ctx = _make_ctx(usage_tracker=tracker)

    with patch("graph_caster.nodes.llm.get_default_registry", return_value=registry):
        await _run_node(
            node, ctx,
            provider="openai",
            model="gpt-4o-mini",
            userPrompt="Track this",
        )

    assert tracker.totals.prompt_tokens == 10
    assert tracker.totals.completion_tokens == 5
    assert tracker.call_count == 1
    assert tracker.summary.by_node.get("llm1") is not None


@pytest.mark.anyio
async def test_no_system_prompt_only_user_message() -> None:
    provider = MagicMock()
    provider.name = "openai"
    captured_messages: list = []

    async def _chat(model, messages, *, tools=None, temperature=None, max_tokens=None, stream=False):
        captured_messages.extend(messages)
        return ChatResponse(
            content="ok",
            tool_calls=[],
            usage=TokenUsage(),
            finish_reason="stop",
        )

    provider.chat = _chat
    registry = _make_registry(provider)
    node = LLMNode()
    ctx = _make_ctx()

    with patch("graph_caster.nodes.llm.get_default_registry", return_value=registry):
        await _run_node(
            node, ctx,
            provider="openai",
            model="gpt-4o",
            systemPrompt="",
            userPrompt="Just user",
        )

    assert len(captured_messages) == 1
    assert captured_messages[0].role == "user"
    assert captured_messages[0].content == "Just user"
