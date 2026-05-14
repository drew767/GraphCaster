# Copyright GraphCaster. All Rights Reserved.

"""LLM provider abstraction: registry, base types, and Tier-1 providers."""

import os

from graph_caster.llm.errors import (
    LLMAuthError,
    LLMBadRequestError,
    LLMError,
    LLMQuotaExceededError,
    LLMRateLimitError,
    LLMServerError,
    LLMTimeoutError,
)
from graph_caster.llm.fallback import FallbackChat, FallbackPolicy, FallbackTarget
from graph_caster.llm.provider import (
    ChatMessage,
    ChatResponse,
    ChatStreamChunk,
    ModelProvider,
    ToolCall,
    TokenUsage,
)
from graph_caster.llm.pricing import ModelPrice, compute_cost, lookup_price, override_price_table
from graph_caster.llm.registry import ProviderRegistry, get_default_registry
from graph_caster.llm.usage import RunUsage, UsageTracker

__all__ = [
    "ChatMessage",
    "ChatResponse",
    "ChatStreamChunk",
    "FallbackChat",
    "FallbackPolicy",
    "FallbackTarget",
    "LLMAuthError",
    "LLMBadRequestError",
    "LLMError",
    "LLMQuotaExceededError",
    "LLMRateLimitError",
    "LLMServerError",
    "LLMTimeoutError",
    "ModelPrice",
    "ModelProvider",
    "ProviderRegistry",
    "RunUsage",
    "ToolCall",
    "TokenUsage",
    "UsageTracker",
    "compute_cost",
    "get_default_registry",
    "lookup_price",
    "override_price_table",
]


def _auto_register_all() -> None:
    """Import each provider module to trigger their auto-registration if env vars are set."""
    if os.environ.get("OPENAI_API_KEY"):
        from graph_caster.llm.providers.openai import _auto_register as _ar_openai
        _ar_openai()
    if os.environ.get("ANTHROPIC_API_KEY"):
        from graph_caster.llm.providers.anthropic import _auto_register as _ar_anthropic
        _ar_anthropic()
    from graph_caster.llm.providers.ollama import _auto_register as _ar_ollama
    _ar_ollama()
