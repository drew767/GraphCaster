# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import pytest

from graph_caster.llm.provider import (
    ChatMessage,
    ChatResponse,
    ChatStreamChunk,
    ModelProvider,
    ToolCall,
    TokenUsage,
)
from graph_caster.llm.registry import ProviderRegistry


class MockProvider(ModelProvider):
    name = "mock"

    def __init__(self, models: list[str] | None = None) -> None:
        self._models = models or ["mock-v1", "mock-v2"]
        self.last_call: dict | None = None

    async def chat(
        self,
        model: str,
        messages: list[ChatMessage],
        *,
        tools=None,
        temperature=None,
        max_tokens=None,
        stream: bool = False,
    ) -> ChatResponse:
        self.last_call = {"model": model, "messages": messages, "stream": stream}
        return ChatResponse(
            content="mock reply",
            tool_calls=[],
            usage=TokenUsage(prompt_tokens=10, completion_tokens=5, total_tokens=15),
            finish_reason="stop",
            raw={"mock": True},
        )

    async def list_models(self) -> list[str]:
        return self._models


def _fresh_registry() -> ProviderRegistry:
    r = ProviderRegistry()
    return r


def test_register_and_get() -> None:
    r = _fresh_registry()
    p = MockProvider()
    r.register(p)
    assert r.get("mock") is p


def test_list_providers_returns_registered_names() -> None:
    r = _fresh_registry()
    r.register(MockProvider())
    assert "mock" in r.list_providers()


def test_get_unknown_raises_key_error() -> None:
    r = _fresh_registry()
    with pytest.raises(KeyError, match="not registered"):
        r.get("nonexistent")


def test_register_replaces_existing() -> None:
    r = _fresh_registry()
    p1 = MockProvider(models=["m1"])
    p2 = MockProvider(models=["m2"])
    r.register(p1)
    r.register(p2)
    assert r.get("mock") is p2


def test_unregister() -> None:
    r = _fresh_registry()
    r.register(MockProvider())
    r.unregister("mock")
    assert "mock" not in r.list_providers()


def test_clear() -> None:
    r = _fresh_registry()
    r.register(MockProvider())
    r.clear()
    assert r.list_providers() == []


def test_chat_message_to_dict_and_from_dict() -> None:
    msg = ChatMessage(role="user", content="hello")
    d = msg.to_dict()
    assert d["role"] == "user"
    assert d["content"] == "hello"
    assert "tool_calls" not in d

    restored = ChatMessage.from_dict(d)
    assert restored.role == "user"
    assert restored.content == "hello"
    assert restored.tool_calls is None


def test_chat_message_with_tool_calls_roundtrip() -> None:
    tc = ToolCall(id="call_1", name="get_weather", arguments={"location": "Paris"})
    msg = ChatMessage(role="assistant", content="", tool_calls=[tc])
    d = msg.to_dict()
    assert len(d["tool_calls"]) == 1
    assert d["tool_calls"][0]["name"] == "get_weather"

    restored = ChatMessage.from_dict(d)
    assert restored.tool_calls is not None
    assert restored.tool_calls[0].name == "get_weather"
    assert restored.tool_calls[0].arguments == {"location": "Paris"}


def test_chat_response_to_dict_and_from_dict() -> None:
    resp = ChatResponse(
        content="hi there",
        tool_calls=[],
        usage=TokenUsage(prompt_tokens=5, completion_tokens=3, total_tokens=8),
        finish_reason="stop",
        raw={"model": "mock-v1"},
    )
    d = resp.to_dict()
    assert d["content"] == "hi there"
    assert d["finish_reason"] == "stop"
    assert d["usage"]["prompt_tokens"] == 5

    restored = ChatResponse.from_dict(d)
    assert restored.content == "hi there"
    assert restored.usage.prompt_tokens == 5
    assert restored.usage.total_tokens == 8


def test_tool_call_roundtrip() -> None:
    tc = ToolCall(id="c1", name="search", arguments={"q": "foo"})
    d = tc.to_dict()
    assert d == {"id": "c1", "name": "search", "arguments": {"q": "foo"}}
    restored = ToolCall.from_dict(d)
    assert restored.id == "c1"
    assert restored.name == "search"
    assert restored.arguments == {"q": "foo"}


def test_token_usage_roundtrip() -> None:
    u = TokenUsage(prompt_tokens=100, completion_tokens=50, total_tokens=150)
    d = u.to_dict()
    restored = TokenUsage.from_dict(d)
    assert restored.prompt_tokens == 100
    assert restored.completion_tokens == 50
    assert restored.total_tokens == 150


def test_mock_provider_chat_returns_response() -> None:
    async def _run() -> None:
        r = _fresh_registry()
        provider = MockProvider()
        r.register(provider)
        p = r.get("mock")
        msgs = [ChatMessage(role="user", content="hello")]
        result = await p.chat("mock-v1", msgs)
        assert isinstance(result, ChatResponse)
        assert result.content == "mock reply"
        assert result.usage.total_tokens == 15
        assert result.finish_reason == "stop"

    import asyncio
    asyncio.run(_run())


def test_mock_provider_list_models() -> None:
    async def _run() -> None:
        p = MockProvider(models=["model-a", "model-b"])
        models = await p.list_models()
        assert models == ["model-a", "model-b"]

    import asyncio
    asyncio.run(_run())


def test_chat_response_with_tool_calls_roundtrip() -> None:
    resp = ChatResponse(
        content="",
        tool_calls=[ToolCall(id="t1", name="lookup", arguments={"key": "val"})],
        usage=TokenUsage(),
        finish_reason="tool_calls",
        raw={},
    )
    d = resp.to_dict()
    restored = ChatResponse.from_dict(d)
    assert len(restored.tool_calls) == 1
    assert restored.tool_calls[0].name == "lookup"
    assert restored.finish_reason == "tool_calls"
