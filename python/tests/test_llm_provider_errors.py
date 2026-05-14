# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from graph_caster.llm.errors import (
    LLMAuthError,
    LLMBadRequestError,
    LLMRateLimitError,
    LLMServerError,
    LLMTimeoutError,
)
from graph_caster.llm.provider import ChatMessage
from graph_caster.llm.providers.anthropic import AnthropicProvider
from graph_caster.llm.providers.ollama import OllamaProvider
from graph_caster.llm.providers.openai import OpenAIProvider


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_client(response: httpx.Response) -> httpx.AsyncClient:
    def _handler(req: httpx.Request) -> httpx.Response:
        return response

    return httpx.AsyncClient(transport=httpx.MockTransport(_handler))


def _make_timeout_client() -> httpx.AsyncClient:
    def _handler(req: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out", request=req)

    return httpx.AsyncClient(transport=httpx.MockTransport(_handler))


_MSGS = [ChatMessage(role="user", content="hello")]


# ---------------------------------------------------------------------------
# OpenAI error mapping
# ---------------------------------------------------------------------------

def test_openai_429_raises_rate_limit() -> None:
    body = {"error": {"message": "rate limit exceeded", "code": "rate_limit"}}
    client = _make_client(httpx.Response(429, json=body))
    provider = OpenAIProvider(api_key="sk-test", http_client=client)

    async def _run() -> None:
        await provider.chat("gpt-4o", _MSGS)

    with pytest.raises(LLMRateLimitError):
        asyncio.run(_run())


def test_openai_500_raises_server_error() -> None:
    body = {"error": {"message": "Internal server error"}}
    client = _make_client(httpx.Response(500, json=body))
    provider = OpenAIProvider(api_key="sk-test", http_client=client)

    async def _run() -> None:
        await provider.chat("gpt-4o", _MSGS)

    with pytest.raises(LLMServerError):
        asyncio.run(_run())


def test_openai_timeout_raises_llm_timeout() -> None:
    client = _make_timeout_client()
    provider = OpenAIProvider(api_key="sk-test", http_client=client)

    async def _run() -> None:
        await provider.chat("gpt-4o", _MSGS)

    with pytest.raises(LLMTimeoutError):
        asyncio.run(_run())


def test_openai_401_raises_auth_error() -> None:
    body = {"error": {"message": "Incorrect API key"}}
    client = _make_client(httpx.Response(401, json=body))
    provider = OpenAIProvider(api_key="sk-bad", http_client=client)

    async def _run() -> None:
        await provider.chat("gpt-4o", _MSGS)

    with pytest.raises(LLMAuthError):
        asyncio.run(_run())


def test_openai_403_raises_auth_error() -> None:
    body = {"error": {"message": "Forbidden"}}
    client = _make_client(httpx.Response(403, json=body))
    provider = OpenAIProvider(api_key="sk-bad", http_client=client)

    async def _run() -> None:
        await provider.chat("gpt-4o", _MSGS)

    with pytest.raises(LLMAuthError):
        asyncio.run(_run())


def test_openai_400_raises_bad_request() -> None:
    body = {"error": {"message": "Invalid model"}}
    client = _make_client(httpx.Response(400, json=body))
    provider = OpenAIProvider(api_key="sk-test", http_client=client)

    async def _run() -> None:
        await provider.chat("bad-model", _MSGS)

    with pytest.raises(LLMBadRequestError):
        asyncio.run(_run())


# ---------------------------------------------------------------------------
# Anthropic error mapping
# ---------------------------------------------------------------------------

def test_anthropic_429_raises_rate_limit() -> None:
    body = {"type": "error", "error": {"type": "rate_limit_error", "message": "rate limit"}}
    client = _make_client(httpx.Response(429, json=body))
    provider = AnthropicProvider(api_key="ant-test", http_client=client)

    async def _run() -> None:
        await provider.chat("claude-sonnet-4-5", _MSGS)

    with pytest.raises(LLMRateLimitError):
        asyncio.run(_run())


def test_anthropic_500_raises_server_error() -> None:
    body = {"type": "error", "error": {"type": "api_error", "message": "server error"}}
    client = _make_client(httpx.Response(500, json=body))
    provider = AnthropicProvider(api_key="ant-test", http_client=client)

    async def _run() -> None:
        await provider.chat("claude-sonnet-4-5", _MSGS)

    with pytest.raises(LLMServerError):
        asyncio.run(_run())


def test_anthropic_timeout_raises_llm_timeout() -> None:
    client = _make_timeout_client()
    provider = AnthropicProvider(api_key="ant-test", http_client=client)

    async def _run() -> None:
        await provider.chat("claude-sonnet-4-5", _MSGS)

    with pytest.raises(LLMTimeoutError):
        asyncio.run(_run())


def test_anthropic_401_raises_auth_error() -> None:
    body = {"type": "error", "error": {"type": "authentication_error", "message": "bad key"}}
    client = _make_client(httpx.Response(401, json=body))
    provider = AnthropicProvider(api_key="ant-bad", http_client=client)

    async def _run() -> None:
        await provider.chat("claude-sonnet-4-5", _MSGS)

    with pytest.raises(LLMAuthError):
        asyncio.run(_run())


def test_anthropic_400_raises_bad_request() -> None:
    body = {"type": "error", "error": {"type": "invalid_request_error", "message": "bad request"}}
    client = _make_client(httpx.Response(400, json=body))
    provider = AnthropicProvider(api_key="ant-test", http_client=client)

    async def _run() -> None:
        await provider.chat("claude-sonnet-4-5", _MSGS)

    with pytest.raises(LLMBadRequestError):
        asyncio.run(_run())


# ---------------------------------------------------------------------------
# Ollama error mapping
# ---------------------------------------------------------------------------

def test_ollama_429_raises_rate_limit() -> None:
    body = {"error": "rate limit"}
    client = _make_client(httpx.Response(429, json=body))
    provider = OllamaProvider(base_url="http://localhost:11434", http_client=client)

    async def _run() -> None:
        await provider.chat("llama3", _MSGS)

    with pytest.raises(LLMRateLimitError):
        asyncio.run(_run())


def test_ollama_500_raises_server_error() -> None:
    body = {"error": "internal server error"}
    client = _make_client(httpx.Response(500, json=body))
    provider = OllamaProvider(base_url="http://localhost:11434", http_client=client)

    async def _run() -> None:
        await provider.chat("llama3", _MSGS)

    with pytest.raises(LLMServerError):
        asyncio.run(_run())


def test_ollama_timeout_raises_llm_timeout() -> None:
    client = _make_timeout_client()
    provider = OllamaProvider(base_url="http://localhost:11434", http_client=client)

    async def _run() -> None:
        await provider.chat("llama3", _MSGS)

    with pytest.raises(LLMTimeoutError):
        asyncio.run(_run())


def test_ollama_401_raises_auth_error() -> None:
    body = {"error": "unauthorized"}
    client = _make_client(httpx.Response(401, json=body))
    provider = OllamaProvider(base_url="http://localhost:11434", http_client=client)

    async def _run() -> None:
        await provider.chat("llama3", _MSGS)

    with pytest.raises(LLMAuthError):
        asyncio.run(_run())


def test_ollama_400_raises_bad_request() -> None:
    body = {"error": "model not found"}
    client = _make_client(httpx.Response(400, json=body))
    provider = OllamaProvider(base_url="http://localhost:11434", http_client=client)

    async def _run() -> None:
        await provider.chat("bad-model", _MSGS)

    with pytest.raises(LLMBadRequestError):
        asyncio.run(_run())
