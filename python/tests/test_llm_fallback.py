# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from graph_caster.llm.errors import (
    LLMAuthError,
    LLMRateLimitError,
    LLMServerError,
    LLMTimeoutError,
)
from graph_caster.llm.fallback import FallbackChat, FallbackPolicy, FallbackTarget
from graph_caster.llm.provider import ChatMessage, ChatResponse, TokenUsage
from graph_caster.llm.registry import ProviderRegistry


# ---------------------------------------------------------------------------
# Fake providers
# ---------------------------------------------------------------------------

def _ok_response(text: str = "ok") -> ChatResponse:
    return ChatResponse(
        content=text,
        usage=TokenUsage(prompt_tokens=5, completion_tokens=5, total_tokens=10),
    )


class _FailProvider:
    """Provider that raises a given exception on chat()."""

    def __init__(self, name: str, exc: Exception) -> None:
        self.name = name
        self._exc = exc

    async def chat(self, model: str, messages: Any, **kwargs: Any) -> ChatResponse:
        raise self._exc


class _OkProvider:
    """Provider that returns a fixed response."""

    def __init__(self, name: str, response: ChatResponse | None = None) -> None:
        self.name = name
        self._response = response or _ok_response()

    async def chat(self, model: str, messages: Any, **kwargs: Any) -> ChatResponse:
        return self._response


def _make_registry(*providers: Any) -> ProviderRegistry:
    reg = ProviderRegistry()
    for p in providers:
        reg.register(p)  # type: ignore[arg-type]
    return reg


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_fallback_used_on_rate_limit() -> None:
    """First provider fails with rate-limit; second succeeds; fallback event emitted."""
    p1 = _FailProvider("p1", LLMRateLimitError("rate limit"))
    p2 = _OkProvider("p2", _ok_response("from-p2"))
    registry = _make_registry(p1, p2)

    policy = FallbackPolicy(
        targets=[
            FallbackTarget(provider="p1", model="m1"),
            FallbackTarget(provider="p2", model="m2"),
        ],
        triggers={"rate_limit"},
    )

    events: list[dict[str, Any]] = []

    async def _run() -> ChatResponse:
        chat = FallbackChat(registry, policy)
        with patch("anyio.sleep", new=AsyncMock(return_value=None)):
            return await chat.invoke(
                [ChatMessage(role="user", content="hi")],
                emit_event=events.append,
            )

    result = asyncio.run(_run())

    assert result.content == "from-p2"

    event_types = [e["type"] for e in events]
    assert "llm_attempt" in event_types
    assert "llm_attempt_failed" in event_types
    assert "llm_fallback_used" in event_types
    assert "llm_success" in event_types

    fallback_ev = next(e for e in events if e["type"] == "llm_fallback_used")
    assert fallback_ev["from"]["provider"] == "p1"
    assert fallback_ev["to"]["provider"] == "p2"
    assert fallback_ev["reason"] == "rate_limit"


def test_auth_error_propagates_immediately() -> None:
    """Auth error is not in triggers → no fallback, raises immediately."""
    p1 = _FailProvider("p1", LLMAuthError("bad key"))
    p2 = _OkProvider("p2")
    registry = _make_registry(p1, p2)

    policy = FallbackPolicy(
        targets=[
            FallbackTarget(provider="p1", model="m1"),
            FallbackTarget(provider="p2", model="m2"),
        ],
        triggers={"rate_limit", "server_error"},
    )

    events: list[dict[str, Any]] = []

    async def _run() -> None:
        chat = FallbackChat(registry, policy)
        with patch("anyio.sleep", new=AsyncMock(return_value=None)):
            await chat.invoke(
                [ChatMessage(role="user", content="hi")],
                emit_event=events.append,
            )

    with pytest.raises(LLMAuthError):
        asyncio.run(_run())

    event_types = [e["type"] for e in events]
    assert "llm_fallback_used" not in event_types
    assert "llm_success" not in event_types


def test_all_providers_fail_raises_last_exception() -> None:
    """All providers fail → last exception raised, attempts == len(targets)."""
    exc1 = LLMRateLimitError("first")
    exc2 = LLMServerError("second")
    p1 = _FailProvider("p1", exc1)
    p2 = _FailProvider("p2", exc2)
    registry = _make_registry(p1, p2)

    policy = FallbackPolicy(
        targets=[
            FallbackTarget(provider="p1", model="m1"),
            FallbackTarget(provider="p2", model="m2"),
        ],
        triggers={"rate_limit", "server_error"},
    )

    events: list[dict[str, Any]] = []

    async def _run() -> None:
        chat = FallbackChat(registry, policy)
        with patch("anyio.sleep", new=AsyncMock(return_value=None)):
            await chat.invoke(
                [ChatMessage(role="user", content="hi")],
                emit_event=events.append,
            )

    with pytest.raises(LLMServerError):
        asyncio.run(_run())

    attempt_events = [e for e in events if e["type"] == "llm_attempt"]
    assert len(attempt_events) == 2


def test_max_attempts_caps_targets() -> None:
    """max_attempts=2 with 3 targets → only 2 attempts."""
    p1 = _FailProvider("p1", LLMRateLimitError("rl"))
    p2 = _FailProvider("p2", LLMServerError("srv"))
    p3 = _OkProvider("p3")
    registry = _make_registry(p1, p2, p3)

    policy = FallbackPolicy(
        targets=[
            FallbackTarget(provider="p1", model="m1"),
            FallbackTarget(provider="p2", model="m2"),
            FallbackTarget(provider="p3", model="m3"),
        ],
        triggers={"rate_limit", "server_error"},
        max_attempts=2,
    )

    events: list[dict[str, Any]] = []

    async def _run() -> None:
        chat = FallbackChat(registry, policy)
        with patch("anyio.sleep", new=AsyncMock(return_value=None)):
            await chat.invoke(
                [ChatMessage(role="user", content="hi")],
                emit_event=events.append,
            )

    with pytest.raises(LLMServerError):
        asyncio.run(_run())

    attempt_events = [e for e in events if e["type"] == "llm_attempt"]
    assert len(attempt_events) == 2

    success_events = [e for e in events if e["type"] == "llm_success"]
    assert len(success_events) == 0


def test_backoff_timing_patched() -> None:
    """Backoff sleep is called with exponential values between attempts."""
    p1 = _FailProvider("p1", LLMRateLimitError("rl"))
    p2 = _FailProvider("p2", LLMTimeoutError("to"))
    p3 = _OkProvider("p3")
    registry = _make_registry(p1, p2, p3)

    policy = FallbackPolicy(
        targets=[
            FallbackTarget(provider="p1", model="m1"),
            FallbackTarget(provider="p2", model="m2"),
            FallbackTarget(provider="p3", model="m3"),
        ],
        triggers={"rate_limit", "timeout"},
        backoff_base=0.5,
        max_backoff=8.0,
    )

    sleep_calls: list[float] = []

    async def _fake_sleep(secs: float) -> None:
        sleep_calls.append(secs)

    async def _run() -> ChatResponse:
        chat = FallbackChat(registry, policy)
        with patch("anyio.sleep", side_effect=_fake_sleep):
            return await chat.invoke([ChatMessage(role="user", content="hi")])

    result = asyncio.run(_run())
    assert result.content == "ok"

    # attempt 0 → sleep(0.5 * 2^0 = 0.5), attempt 1 → sleep(0.5 * 2^1 = 1.0)
    assert len(sleep_calls) == 2
    assert sleep_calls[0] == pytest.approx(0.5)
    assert sleep_calls[1] == pytest.approx(1.0)


def test_first_attempt_succeeds_no_fallback() -> None:
    """If first provider succeeds, no fallback or sleep happens."""
    p1 = _OkProvider("p1", _ok_response("direct"))
    registry = _make_registry(p1)

    policy = FallbackPolicy(
        targets=[FallbackTarget(provider="p1", model="m1")],
    )

    events: list[dict[str, Any]] = []
    sleep_calls: list[float] = []

    async def _fake_sleep(secs: float) -> None:
        sleep_calls.append(secs)

    async def _run() -> ChatResponse:
        chat = FallbackChat(registry, policy)
        with patch("anyio.sleep", side_effect=_fake_sleep):
            return await chat.invoke(
                [ChatMessage(role="user", content="hi")],
                emit_event=events.append,
            )

    result = asyncio.run(_run())
    assert result.content == "direct"
    assert sleep_calls == []
    assert any(e["type"] == "llm_success" for e in events)
    assert not any(e["type"] == "llm_fallback_used" for e in events)
