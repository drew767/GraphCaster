# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import asyncio
import json
from typing import Any, AsyncIterator, Iterator

import httpx
import pytest

from graph_caster.llm.provider import (
    ChatMessage,
    ChatResponse,
    ChatStreamChunk,
    TokenUsage,
    ToolCall,
)
from graph_caster.llm.providers.openai import OpenAIProvider, _parse_openai_response
from graph_caster.llm.providers.anthropic import AnthropicProvider, _parse_anthropic_response
from graph_caster.llm.providers.ollama import OllamaProvider, _parse_ollama_response


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_transport(responses: list[httpx.Response]) -> httpx.MockTransport:
    """Return a MockTransport that serves responses in order."""
    it = iter(responses)

    def _handler(request: httpx.Request) -> httpx.Response:
        return next(it)

    return httpx.MockTransport(_handler)


def _sse_body(events: list[dict[str, Any] | str]) -> bytes:
    """Build an SSE body from a list of data objects (or raw strings like '[DONE]')."""
    lines: list[str] = []
    for ev in events:
        if isinstance(ev, str):
            lines.append(f"data: {ev}\n\n")
        else:
            lines.append(f"data: {json.dumps(ev)}\n\n")
    return "".join(lines).encode()


# ---------------------------------------------------------------------------
# OpenAI provider tests
# ---------------------------------------------------------------------------

_OPENAI_CHAT_RESPONSE = {
    "id": "chatcmpl-123",
    "object": "chat.completion",
    "choices": [
        {
            "index": 0,
            "message": {"role": "assistant", "content": "Hello from OpenAI"},
            "finish_reason": "stop",
        }
    ],
    "usage": {"prompt_tokens": 10, "completion_tokens": 7, "total_tokens": 17},
}

_OPENAI_TOOL_RESPONSE = {
    "id": "chatcmpl-456",
    "object": "chat.completion",
    "choices": [
        {
            "index": 0,
            "message": {
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "id": "call_abc",
                        "type": "function",
                        "function": {
                            "name": "get_weather",
                            "arguments": '{"location":"Paris"}',
                        },
                    }
                ],
            },
            "finish_reason": "tool_calls",
        }
    ],
    "usage": {"prompt_tokens": 20, "completion_tokens": 15, "total_tokens": 35},
}

_OPENAI_MODELS_RESPONSE = {
    "object": "list",
    "data": [
        {"id": "gpt-4o"},
        {"id": "gpt-4o-mini"},
    ],
}


def test_openai_parse_response_basic() -> None:
    resp = _parse_openai_response(_OPENAI_CHAT_RESPONSE)
    assert resp.content == "Hello from OpenAI"
    assert resp.finish_reason == "stop"
    assert resp.usage.prompt_tokens == 10
    assert resp.usage.completion_tokens == 7
    assert resp.usage.total_tokens == 17
    assert resp.tool_calls == []


def test_openai_parse_response_tool_calls() -> None:
    resp = _parse_openai_response(_OPENAI_TOOL_RESPONSE)
    assert resp.content == ""
    assert resp.finish_reason == "tool_calls"
    assert len(resp.tool_calls) == 1
    tc = resp.tool_calls[0]
    assert tc.id == "call_abc"
    assert tc.name == "get_weather"
    assert tc.arguments == {"location": "Paris"}


def test_openai_chat_request_shape() -> None:
    transport = _make_transport([
        httpx.Response(200, json=_OPENAI_CHAT_RESPONSE),
    ])
    captured_requests: list[httpx.Request] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        captured_requests.append(request)
        return httpx.Response(200, json=_OPENAI_CHAT_RESPONSE)

    client = httpx.AsyncClient(transport=httpx.MockTransport(_handler))
    provider = OpenAIProvider(api_key="sk-test", http_client=client)

    async def _run() -> ChatResponse:
        msgs = [ChatMessage(role="user", content="hi")]
        result = await provider.chat("gpt-4o", msgs)
        assert isinstance(result, ChatResponse)
        return result

    result = asyncio.run(_run())
    assert result.content == "Hello from OpenAI"

    assert len(captured_requests) == 1
    req = captured_requests[0]
    assert req.method == "POST"
    assert "/chat/completions" in str(req.url)
    assert req.headers["authorization"] == "Bearer sk-test"
    body = json.loads(req.content)
    assert body["model"] == "gpt-4o"
    assert body["messages"][0]["role"] == "user"
    assert body["messages"][0]["content"] == "hi"


def test_openai_chat_with_tools() -> None:
    def _handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_OPENAI_TOOL_RESPONSE)

    client = httpx.AsyncClient(transport=httpx.MockTransport(_handler))
    provider = OpenAIProvider(api_key="sk-test", http_client=client)
    tools = [{"type": "function", "function": {"name": "get_weather", "parameters": {}}}]

    async def _run() -> ChatResponse:
        msgs = [ChatMessage(role="user", content="weather?")]
        result = await provider.chat("gpt-4o", msgs, tools=tools)
        assert isinstance(result, ChatResponse)
        return result

    result = asyncio.run(_run())
    assert len(result.tool_calls) == 1
    assert result.tool_calls[0].name == "get_weather"


def test_openai_list_models() -> None:
    def _handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_OPENAI_MODELS_RESPONSE)

    client = httpx.AsyncClient(transport=httpx.MockTransport(_handler))
    provider = OpenAIProvider(api_key="sk-test", http_client=client)

    async def _run() -> list[str]:
        return await provider.list_models()

    models = asyncio.run(_run())
    assert "gpt-4o" in models
    assert "gpt-4o-mini" in models


def test_openai_stream_yields_chunks() -> None:
    stream_events = [
        {"choices": [{"delta": {"content": "Hello"}, "finish_reason": None, "index": 0}]},
        {"choices": [{"delta": {"content": " world"}, "finish_reason": None, "index": 0}]},
        {"choices": [{"delta": {}, "finish_reason": "stop", "index": 0}]},
        "[DONE]",
    ]
    sse_body = _sse_body(stream_events)

    def _handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=sse_body,
            headers={"Content-Type": "text/event-stream"},
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(_handler))
    provider = OpenAIProvider(api_key="sk-test", http_client=client)

    async def _run() -> list[ChatStreamChunk]:
        msgs = [ChatMessage(role="user", content="hi")]
        result = await provider.chat("gpt-4o", msgs, stream=True)
        chunks: list[ChatStreamChunk] = []
        async for chunk in result:  # type: ignore[union-attr]
            chunks.append(chunk)
        return chunks

    chunks = asyncio.run(_run())
    deltas = [c.delta for c in chunks]
    assert "Hello" in deltas
    assert " world" in deltas
    full_text = "".join(deltas)
    assert "Hello world" in full_text
    finish_reasons = [c.finish_reason for c in chunks if c.finish_reason]
    assert "stop" in finish_reasons


def test_openai_temperature_and_max_tokens_sent() -> None:
    captured: list[dict[str, Any]] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        captured.append(json.loads(request.content))
        return httpx.Response(200, json=_OPENAI_CHAT_RESPONSE)

    client = httpx.AsyncClient(transport=httpx.MockTransport(_handler))
    provider = OpenAIProvider(api_key="sk-test", http_client=client)

    async def _run() -> None:
        msgs = [ChatMessage(role="user", content="test")]
        await provider.chat("gpt-4o", msgs, temperature=0.7, max_tokens=100)

    asyncio.run(_run())
    assert captured[0]["temperature"] == pytest.approx(0.7)
    assert captured[0]["max_tokens"] == 100


# ---------------------------------------------------------------------------
# Anthropic provider tests
# ---------------------------------------------------------------------------

_ANTHROPIC_CHAT_RESPONSE = {
    "id": "msg_01",
    "type": "message",
    "role": "assistant",
    "content": [{"type": "text", "text": "Hello from Anthropic"}],
    "stop_reason": "end_turn",
    "usage": {"input_tokens": 15, "output_tokens": 8},
}

_ANTHROPIC_TOOL_RESPONSE = {
    "id": "msg_02",
    "type": "message",
    "role": "assistant",
    "content": [
        {
            "type": "tool_use",
            "id": "toolu_01",
            "name": "get_weather",
            "input": {"location": "London"},
        }
    ],
    "stop_reason": "tool_use",
    "usage": {"input_tokens": 25, "output_tokens": 10},
}


def test_anthropic_parse_response_basic() -> None:
    resp = _parse_anthropic_response(_ANTHROPIC_CHAT_RESPONSE)
    assert resp.content == "Hello from Anthropic"
    assert resp.finish_reason == "end_turn"
    assert resp.usage.prompt_tokens == 15
    assert resp.usage.completion_tokens == 8
    assert resp.usage.total_tokens == 23
    assert resp.tool_calls == []


def test_anthropic_parse_response_tool_calls() -> None:
    resp = _parse_anthropic_response(_ANTHROPIC_TOOL_RESPONSE)
    assert resp.content == ""
    assert resp.finish_reason == "tool_use"
    assert len(resp.tool_calls) == 1
    tc = resp.tool_calls[0]
    assert tc.id == "toolu_01"
    assert tc.name == "get_weather"
    assert tc.arguments == {"location": "London"}


def test_anthropic_chat_request_shape() -> None:
    captured: list[httpx.Request] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json=_ANTHROPIC_CHAT_RESPONSE)

    client = httpx.AsyncClient(transport=httpx.MockTransport(_handler))
    provider = AnthropicProvider(api_key="ant-test", http_client=client)

    async def _run() -> ChatResponse:
        msgs = [
            ChatMessage(role="system", content="You are helpful."),
            ChatMessage(role="user", content="hello"),
        ]
        result = await provider.chat("claude-sonnet-4-5", msgs)
        assert isinstance(result, ChatResponse)
        return result

    result = asyncio.run(_run())
    assert result.content == "Hello from Anthropic"

    req = captured[0]
    assert req.headers["x-api-key"] == "ant-test"
    assert "anthropic-version" in req.headers
    body = json.loads(req.content)
    assert body["model"] == "claude-sonnet-4-5"
    assert body["system"] == "You are helpful."
    assert body["messages"][0]["role"] == "user"


def test_anthropic_stream_yields_chunks() -> None:
    stream_events = [
        {"type": "message_start", "message": {"id": "msg_01", "usage": {"input_tokens": 5}}},
        {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
        {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Hello "}},
        {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "Anthropic"}},
        {"type": "content_block_stop", "index": 0},
        {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence": None}},
        {"type": "message_stop"},
    ]
    sse_body = _sse_body(stream_events)

    def _handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            content=sse_body,
            headers={"Content-Type": "text/event-stream"},
        )

    client = httpx.AsyncClient(transport=httpx.MockTransport(_handler))
    provider = AnthropicProvider(api_key="ant-test", http_client=client)

    async def _run() -> list[ChatStreamChunk]:
        msgs = [ChatMessage(role="user", content="hi")]
        result = await provider.chat("claude-sonnet-4-5", msgs, stream=True)
        chunks: list[ChatStreamChunk] = []
        async for chunk in result:  # type: ignore[union-attr]
            chunks.append(chunk)
        return chunks

    chunks = asyncio.run(_run())
    text_chunks = [c for c in chunks if c.delta]
    full_text = "".join(c.delta for c in text_chunks)
    assert "Hello Anthropic" in full_text
    finish_chunks = [c for c in chunks if c.finish_reason]
    assert any(c.finish_reason == "end_turn" for c in finish_chunks)


def test_anthropic_list_models() -> None:
    provider = AnthropicProvider(api_key="ant-test")

    async def _run() -> list[str]:
        return await provider.list_models()

    models = asyncio.run(_run())
    assert len(models) > 0
    assert any("claude" in m for m in models)


# ---------------------------------------------------------------------------
# Ollama provider tests
# ---------------------------------------------------------------------------

_OLLAMA_CHAT_RESPONSE = {
    "model": "llama3",
    "message": {"role": "assistant", "content": "Hello from Ollama"},
    "done": True,
    "done_reason": "stop",
    "prompt_eval_count": 12,
    "eval_count": 6,
}

_OLLAMA_TAGS_RESPONSE = {
    "models": [
        {"name": "llama3:latest"},
        {"name": "mistral:7b"},
    ]
}


def test_ollama_parse_response_basic() -> None:
    resp = _parse_ollama_response(_OLLAMA_CHAT_RESPONSE)
    assert resp.content == "Hello from Ollama"
    assert resp.finish_reason == "stop"
    assert resp.usage.prompt_tokens == 12
    assert resp.usage.completion_tokens == 6
    assert resp.usage.total_tokens == 18


def test_ollama_chat_request_shape() -> None:
    captured: list[httpx.Request] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json=_OLLAMA_CHAT_RESPONSE)

    client = httpx.AsyncClient(transport=httpx.MockTransport(_handler))
    provider = OllamaProvider(base_url="http://localhost:11434", http_client=client)

    async def _run() -> ChatResponse:
        msgs = [ChatMessage(role="user", content="hi ollama")]
        result = await provider.chat("llama3", msgs)
        assert isinstance(result, ChatResponse)
        return result

    result = asyncio.run(_run())
    assert result.content == "Hello from Ollama"

    req = captured[0]
    assert "/api/chat" in str(req.url)
    body = json.loads(req.content)
    assert body["model"] == "llama3"
    assert body["messages"][0]["content"] == "hi ollama"
    assert body["stream"] is False


def test_ollama_list_models() -> None:
    def _handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=_OLLAMA_TAGS_RESPONSE)

    client = httpx.AsyncClient(transport=httpx.MockTransport(_handler))
    provider = OllamaProvider(http_client=client)

    async def _run() -> list[str]:
        return await provider.list_models()

    models = asyncio.run(_run())
    assert "llama3:latest" in models
    assert "mistral:7b" in models


def test_ollama_stream_yields_chunks() -> None:
    stream_lines = [
        json.dumps({"model": "llama3", "message": {"role": "assistant", "content": "Hi "}, "done": False}),
        json.dumps({"model": "llama3", "message": {"role": "assistant", "content": "Ollama"}, "done": False}),
        json.dumps({"model": "llama3", "message": {"role": "assistant", "content": ""}, "done": True, "done_reason": "stop"}),
    ]
    body = "\n".join(stream_lines).encode()

    def _handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=body)

    client = httpx.AsyncClient(transport=httpx.MockTransport(_handler))
    provider = OllamaProvider(http_client=client)

    async def _run() -> list[ChatStreamChunk]:
        msgs = [ChatMessage(role="user", content="hi")]
        result = await provider.chat("llama3", msgs, stream=True)
        chunks: list[ChatStreamChunk] = []
        async for chunk in result:  # type: ignore[union-attr]
            chunks.append(chunk)
        return chunks

    chunks = asyncio.run(_run())
    full_text = "".join(c.delta for c in chunks)
    assert "Hi Ollama" in full_text
    finish_chunks = [c for c in chunks if c.finish_reason]
    assert any(c.finish_reason == "stop" for c in finish_chunks)


def test_ollama_options_forwarded() -> None:
    captured: list[dict[str, Any]] = []

    def _handler(request: httpx.Request) -> httpx.Response:
        captured.append(json.loads(request.content))
        return httpx.Response(200, json=_OLLAMA_CHAT_RESPONSE)

    client = httpx.AsyncClient(transport=httpx.MockTransport(_handler))
    provider = OllamaProvider(http_client=client)

    async def _run() -> None:
        msgs = [ChatMessage(role="user", content="test")]
        await provider.chat("llama3", msgs, temperature=0.5, max_tokens=200)

    asyncio.run(_run())
    opts = captured[0].get("options") or {}
    assert opts.get("temperature") == pytest.approx(0.5)
    assert opts.get("num_predict") == 200
