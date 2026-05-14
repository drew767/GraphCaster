# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import warnings

import pytest

from graph_caster.llm.pricing import (
    ModelPrice,
    PRICE_TABLE,
    compute_cost,
    lookup_price,
    override_price_table,
)
from graph_caster.llm.provider import TokenUsage


def teardown_function() -> None:
    override_price_table({})


def test_lookup_known_model() -> None:
    mp = lookup_price("openai", "gpt-4o-mini")
    assert mp is not None
    assert mp.provider == "openai"
    assert mp.model == "gpt-4o-mini"
    assert mp.input_per_1k == pytest.approx(0.00015)
    assert mp.output_per_1k == pytest.approx(0.0006)
    assert mp.currency == "USD"


def test_lookup_anthropic() -> None:
    mp = lookup_price("anthropic", "claude-sonnet-4")
    assert mp is not None
    assert mp.input_per_1k == pytest.approx(0.003)
    assert mp.output_per_1k == pytest.approx(0.015)


def test_lookup_ollama_wildcard() -> None:
    mp = lookup_price("ollama", "llama3")
    assert mp is not None
    assert mp.input_per_1k == pytest.approx(0.0)
    assert mp.output_per_1k == pytest.approx(0.0)


def test_lookup_unknown_model_returns_none() -> None:
    mp = lookup_price("some_provider", "nonexistent-model-xyz")
    assert mp is None


def test_lookup_unknown_emits_warning_via_compute_cost() -> None:
    usage = TokenUsage(prompt_tokens=100, completion_tokens=50, total_tokens=150)
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        cost = compute_cost(usage, "unknown_provider", "unknown_model")
    assert cost == pytest.approx(0.0)
    assert any("0.0" in str(w.message) or "cost" in str(w.message).lower() for w in caught)


def test_compute_cost_gpt4o_mini() -> None:
    usage = TokenUsage(prompt_tokens=1000, completion_tokens=500, total_tokens=1500)
    cost = compute_cost(usage, "openai", "gpt-4o-mini")
    expected = (1000 / 1000) * 0.00015 + (500 / 1000) * 0.0006
    assert cost == pytest.approx(expected)
    assert cost == pytest.approx(0.00015 + 0.0003)
    assert cost == pytest.approx(0.00045)


def test_compute_cost_ollama_is_zero() -> None:
    usage = TokenUsage(prompt_tokens=5000, completion_tokens=3000, total_tokens=8000)
    cost = compute_cost(usage, "ollama", "mistral")
    assert cost == pytest.approx(0.0)


def test_override_adds_custom_entry() -> None:
    custom = ModelPrice("acme", "acme-gpt", 0.001, 0.002)
    override_price_table({("acme", "acme-gpt"): custom})
    mp = lookup_price("acme", "acme-gpt")
    assert mp is not None
    assert mp.input_per_1k == pytest.approx(0.001)


def test_override_persists_across_lookups() -> None:
    custom = ModelPrice("acme", "acme-gpt", 0.001, 0.002)
    override_price_table({("acme", "acme-gpt"): custom})
    assert lookup_price("acme", "acme-gpt") is not None
    assert lookup_price("acme", "acme-gpt") is not None


def test_override_can_be_undone() -> None:
    override_price_table({("acme", "acme-gpt"): ModelPrice("acme", "acme-gpt", 0.001, 0.002)})
    assert lookup_price("acme", "acme-gpt") is not None
    override_price_table({})
    assert lookup_price("acme", "acme-gpt") is None


def test_override_does_not_remove_builtins() -> None:
    override_price_table({("acme", "acme-gpt"): ModelPrice("acme", "acme-gpt", 0.001, 0.002)})
    assert lookup_price("openai", "gpt-4o") is not None
    override_price_table({})
    assert lookup_price("openai", "gpt-4o") is not None


def test_all_builtin_entries_present() -> None:
    for key in PRICE_TABLE:
        provider, model = key
        mp = lookup_price(provider, model)
        assert mp is not None, f"Missing entry for ({provider!r}, {model!r})"
