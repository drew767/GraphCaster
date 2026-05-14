# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Callable, Literal

import anyio

from graph_caster.llm.errors import (
    LLMError,
    LLMQuotaExceededError,
    LLMRateLimitError,
    LLMServerError,
    LLMTimeoutError,
)
from graph_caster.llm.provider import ChatMessage, ChatResponse
from graph_caster.llm.registry import ProviderRegistry

_TRIGGER_MAP: dict[str, tuple[type[Exception], ...]] = {
    "rate_limit": (LLMRateLimitError,),
    "quota_exceeded": (LLMQuotaExceededError,),
    "timeout": (LLMTimeoutError,),
    "server_error": (LLMServerError,),
    "any_error": (Exception,),
}


@dataclass
class FallbackTarget:
    provider: str
    model: str
    weight: float = 1.0


@dataclass
class FallbackPolicy:
    targets: list[FallbackTarget]
    triggers: set[Literal["rate_limit", "quota_exceeded", "timeout", "server_error", "any_error"]] = field(
        default_factory=lambda: {"rate_limit", "quota_exceeded", "timeout", "server_error"}
    )
    max_attempts: int = 0
    backoff_base: float = 0.5
    max_backoff: float = 8.0


def _should_fallback(exc: Exception, triggers: set[str]) -> bool:
    """Return True if exc matches any of the configured trigger classes."""
    for trigger_name in triggers:
        exc_types = _TRIGGER_MAP.get(trigger_name, ())
        if isinstance(exc, exc_types):
            return True
    return False


def _classify_trigger(exc: Exception) -> str:
    """Return the trigger name that best matches exc."""
    if isinstance(exc, LLMRateLimitError):
        return "rate_limit"
    if isinstance(exc, LLMQuotaExceededError):
        return "quota_exceeded"
    if isinstance(exc, LLMTimeoutError):
        return "timeout"
    if isinstance(exc, LLMServerError):
        return "server_error"
    return "any_error"


def _backoff_sec(attempt: int, base: float, max_backoff: float) -> float:
    """Exponential backoff: base * 2**attempt, capped at max_backoff."""
    return min(base * math.pow(2.0, attempt), max_backoff)


class FallbackChat:
    """Wraps a ProviderRegistry call with a fallback chain.

    Usage::

        chat = FallbackChat(registry, policy)
        response = await chat.invoke(messages, emit_event=cb)

    Events emitted via ``emit_event`` (if provided):
    - ``llm_attempt`` — before each attempt
    - ``llm_attempt_failed`` — after a failed attempt that will be retried
    - ``llm_fallback_used`` — when switching to the next target
    - ``llm_success`` — on success
    """

    def __init__(self, registry: ProviderRegistry, policy: FallbackPolicy) -> None:
        self._registry = registry
        self._policy = policy

    async def invoke(
        self,
        messages: list[ChatMessage],
        *,
        tools: list[dict[str, Any]] | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
        stream: bool = False,
        emit_event: Callable[[dict[str, Any]], None] | None = None,
    ) -> ChatResponse:
        policy = self._policy
        targets = policy.targets
        max_attempts = policy.max_attempts if policy.max_attempts > 0 else len(targets)
        max_attempts = min(max_attempts, len(targets))

        last_exc: Exception | None = None

        for attempt_idx in range(max_attempts):
            target = targets[attempt_idx]

            if emit_event is not None:
                emit_event({
                    "type": "llm_attempt",
                    "provider": target.provider,
                    "model": target.model,
                    "attempt": attempt_idx,
                })

            try:
                provider = self._registry.get(target.provider)
                result = await provider.chat(
                    target.model,
                    messages,
                    tools=tools,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    stream=stream,
                )
                if emit_event is not None:
                    usage_dict: dict[str, Any] = {}
                    if isinstance(result, ChatResponse):
                        usage_dict = result.usage.to_dict()
                    emit_event({
                        "type": "llm_success",
                        "provider": target.provider,
                        "model": target.model,
                        "attempt": attempt_idx,
                        "usage": usage_dict,
                    })
                return result  # type: ignore[return-value]

            except Exception as exc:
                last_exc = exc

                if not _should_fallback(exc, policy.triggers):
                    raise

                error_class = type(exc).__name__
                reason = _classify_trigger(exc)

                if emit_event is not None:
                    emit_event({
                        "type": "llm_attempt_failed",
                        "provider": target.provider,
                        "model": target.model,
                        "attempt": attempt_idx,
                        "error_class": error_class,
                        "message": str(exc),
                    })

                next_idx = attempt_idx + 1
                if next_idx < max_attempts:
                    next_target = targets[next_idx]
                    if emit_event is not None:
                        emit_event({
                            "type": "llm_fallback_used",
                            "from": {"provider": target.provider, "model": target.model},
                            "to": {"provider": next_target.provider, "model": next_target.model},
                            "reason": reason,
                        })
                    wait = _backoff_sec(attempt_idx, policy.backoff_base, policy.max_backoff)
                    if wait > 0:
                        await anyio.sleep(wait)

        if last_exc is not None:
            raise last_exc
        raise LLMError("FallbackChat: no targets configured")
