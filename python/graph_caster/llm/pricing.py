# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
import logging
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from graph_caster.llm.provider import TokenUsage

_LOG = logging.getLogger(__name__)

_PRICING_JSON_PATH = Path.home() / ".graphcaster" / "pricing.json"


@dataclass(frozen=True)
class ModelPrice:
    provider: str
    model: str
    input_per_1k: float
    output_per_1k: float
    currency: str = "USD"


PRICE_TABLE: dict[tuple[str, str], ModelPrice] = {
    ("openai", "gpt-4o"):           ModelPrice("openai", "gpt-4o", 0.0025, 0.01),
    ("openai", "gpt-4o-mini"):      ModelPrice("openai", "gpt-4o-mini", 0.00015, 0.0006),
    ("openai", "gpt-4-turbo"):      ModelPrice("openai", "gpt-4-turbo", 0.01, 0.03),
    ("openai", "gpt-3.5-turbo"):    ModelPrice("openai", "gpt-3.5-turbo", 0.0005, 0.0015),
    ("anthropic", "claude-opus-4"):   ModelPrice("anthropic", "claude-opus-4", 0.015, 0.075),
    ("anthropic", "claude-sonnet-4"): ModelPrice("anthropic", "claude-sonnet-4", 0.003, 0.015),
    ("anthropic", "claude-haiku-4"):  ModelPrice("anthropic", "claude-haiku-4", 0.001, 0.005),
    ("ollama", "*"):                  ModelPrice("ollama", "*", 0.0, 0.0),
}

_OVERRIDES: dict[tuple[str, str], ModelPrice] = {}


def _load_user_pricing_overrides() -> dict[tuple[str, str], ModelPrice]:
    if not _PRICING_JSON_PATH.is_file():
        return {}
    try:
        raw: Any = json.loads(_PRICING_JSON_PATH.read_text(encoding="utf-8"))
        if not isinstance(raw, list):
            return {}
        result: dict[tuple[str, str], ModelPrice] = {}
        for entry in raw:
            if not isinstance(entry, dict):
                continue
            provider = str(entry.get("provider") or "").strip()
            model = str(entry.get("model") or "").strip()
            if not provider or not model:
                continue
            result[(provider, model)] = ModelPrice(
                provider=provider,
                model=model,
                input_per_1k=float(entry.get("input_per_1k", 0.0)),
                output_per_1k=float(entry.get("output_per_1k", 0.0)),
                currency=str(entry.get("currency", "USD")),
            )
        return result
    except Exception:
        _LOG.debug("pricing: failed to load %s", _PRICING_JSON_PATH, exc_info=True)
        return {}


_USER_OVERRIDES: dict[tuple[str, str], ModelPrice] = _load_user_pricing_overrides()


def _effective_table() -> dict[tuple[str, str], ModelPrice]:
    merged = {**PRICE_TABLE, **_USER_OVERRIDES, **_OVERRIDES}
    return merged


def lookup_price(provider: str, model: str) -> ModelPrice | None:
    """Exact match first; then provider wildcard '*' fallback."""
    table = _effective_table()
    key = (provider, model)
    if key in table:
        return table[key]
    wildcard = (provider, "*")
    if wildcard in table:
        return table[wildcard]
    return None


def compute_cost(usage: TokenUsage, provider: str, model: str) -> float:
    """Returns USD cost. Returns 0.0 if model unknown (with warning)."""
    price = lookup_price(provider, model)
    if price is None:
        warnings.warn(
            f"pricing: no price entry for provider={provider!r} model={model!r}; cost will be 0.0",
            stacklevel=2,
        )
        return 0.0
    input_cost = (usage.prompt_tokens / 1000.0) * price.input_per_1k
    output_cost = (usage.completion_tokens / 1000.0) * price.output_per_1k
    return input_cost + output_cost


def override_price_table(extra: dict[tuple[str, str], ModelPrice]) -> None:
    """Test/runtime override hook. Merged on top of PRICE_TABLE and user overrides."""
    _OVERRIDES.clear()
    _OVERRIDES.update(extra)
