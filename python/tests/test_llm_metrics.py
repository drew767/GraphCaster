# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import pytest

pytest.importorskip("prometheus_client", reason="prometheus_client not installed")

import prometheus_client  # noqa: E402

from graph_caster.llm.pricing import ModelPrice, override_price_table  # noqa: E402
from graph_caster.llm.provider import TokenUsage  # noqa: E402
from graph_caster.llm.usage import (  # noqa: E402
    UsageTracker,
    _gc_llm_input_tokens,
    _gc_llm_output_tokens,
    _gc_llm_cost_usd,
    _gc_llm_requests,
)


def setup_function() -> None:
    override_price_table({
        ("openai", "gpt-4o-mini"): ModelPrice("openai", "gpt-4o-mini", 0.00015, 0.0006),
    })


def teardown_function() -> None:
    override_price_table({})


def _counter_value(counter: "prometheus_client.Counter", **labels: str) -> float:
    return counter.labels(**labels)._value.get()


def test_input_tokens_counter_increments() -> None:
    tracker = UsageTracker(run_id="prom-run-001")
    before = _counter_value(_gc_llm_input_tokens, provider="openai", model="gpt-4o-mini")
    usage = TokenUsage(prompt_tokens=500, completion_tokens=200, total_tokens=700)
    tracker.record("node-1", "openai", "gpt-4o-mini", usage)
    after = _counter_value(_gc_llm_input_tokens, provider="openai", model="gpt-4o-mini")
    assert after - before == pytest.approx(500)


def test_output_tokens_counter_increments() -> None:
    tracker = UsageTracker(run_id="prom-run-002")
    before = _counter_value(_gc_llm_output_tokens, provider="openai", model="gpt-4o-mini")
    usage = TokenUsage(prompt_tokens=300, completion_tokens=150, total_tokens=450)
    tracker.record("node-2", "openai", "gpt-4o-mini", usage)
    after = _counter_value(_gc_llm_output_tokens, provider="openai", model="gpt-4o-mini")
    assert after - before == pytest.approx(150)


def test_cost_counter_increments() -> None:
    tracker = UsageTracker(run_id="prom-run-003")
    before = _counter_value(_gc_llm_cost_usd, provider="openai", model="gpt-4o-mini")
    usage = TokenUsage(prompt_tokens=1000, completion_tokens=500, total_tokens=1500)
    tracker.record("node-3", "openai", "gpt-4o-mini", usage)
    after = _counter_value(_gc_llm_cost_usd, provider="openai", model="gpt-4o-mini")
    expected_cost = (1000 / 1000) * 0.00015 + (500 / 1000) * 0.0006
    assert after - before == pytest.approx(expected_cost)


def test_requests_counter_increments_success() -> None:
    tracker = UsageTracker(run_id="prom-run-004")
    before = _counter_value(_gc_llm_requests, provider="openai", model="gpt-4o-mini", status="success")
    usage = TokenUsage(prompt_tokens=100, completion_tokens=50, total_tokens=150)
    tracker.record("node-4", "openai", "gpt-4o-mini", usage)
    after = _counter_value(_gc_llm_requests, provider="openai", model="gpt-4o-mini", status="success")
    assert after - before == pytest.approx(1)


def test_requests_counter_error_status() -> None:
    tracker = UsageTracker(run_id="prom-run-005")
    before = _counter_value(_gc_llm_requests, provider="openai", model="gpt-4o-mini", status="error")
    usage = TokenUsage(prompt_tokens=50, completion_tokens=0, total_tokens=50)
    tracker.record("node-5", "openai", "gpt-4o-mini", usage, status="error")
    after = _counter_value(_gc_llm_requests, provider="openai", model="gpt-4o-mini", status="error")
    assert after - before == pytest.approx(1)
