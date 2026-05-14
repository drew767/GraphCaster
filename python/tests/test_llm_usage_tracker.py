# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import pytest

from graph_caster.llm.pricing import override_price_table, ModelPrice
from graph_caster.llm.provider import TokenUsage
from graph_caster.llm.usage import RunUsage, UsageTracker


def setup_function() -> None:
    override_price_table({
        ("openai", "gpt-4o-mini"): ModelPrice("openai", "gpt-4o-mini", 0.00015, 0.0006),
        ("anthropic", "claude-haiku-4"): ModelPrice("anthropic", "claude-haiku-4", 0.001, 0.005),
    })


def teardown_function() -> None:
    override_price_table({})


def test_empty_tracker_zero_totals() -> None:
    tracker = UsageTracker(run_id="run-001")
    s = tracker.summary
    assert s.run_id == "run-001"
    assert s.total_input_tokens == 0
    assert s.total_output_tokens == 0
    assert s.total_cost_usd == pytest.approx(0.0)
    assert s.by_node == {}
    assert s.by_provider == {}
    assert s.by_model == {}


def test_empty_to_dict_keys() -> None:
    tracker = UsageTracker(run_id="run-002")
    d = tracker.to_dict()
    assert "run_id" in d
    assert "call_count" in d
    assert "totals" in d
    assert "total_cost_usd" in d
    assert "by_node" in d
    assert "by_provider" in d
    assert "by_model" in d
    assert d["call_count"] == 0


def test_record_3_entries_2_providers_2_models() -> None:
    tracker = UsageTracker(run_id="run-003")
    u1 = TokenUsage(prompt_tokens=100, completion_tokens=50, total_tokens=150)
    u2 = TokenUsage(prompt_tokens=200, completion_tokens=80, total_tokens=280)
    u3 = TokenUsage(prompt_tokens=300, completion_tokens=120, total_tokens=420)
    tracker.record("node-a", "openai", "gpt-4o-mini", u1)
    tracker.record("node-b", "openai", "gpt-4o-mini", u2)
    tracker.record("node-c", "anthropic", "claude-haiku-4", u3)

    s = tracker.summary
    assert s.total_input_tokens == 600
    assert s.total_output_tokens == 250

    assert "node-a" in s.by_node
    assert "node-b" in s.by_node
    assert "node-c" in s.by_node
    assert s.by_node["node-a"].prompt_tokens == 100
    assert s.by_node["node-b"].prompt_tokens == 200
    assert s.by_node["node-c"].prompt_tokens == 300

    assert set(s.by_provider.keys()) == {"openai", "anthropic"}
    assert s.by_provider["openai"].prompt_tokens == 300
    assert s.by_provider["anthropic"].prompt_tokens == 300

    assert set(s.by_model.keys()) == {"gpt-4o-mini", "claude-haiku-4"}
    assert s.by_model["gpt-4o-mini"].prompt_tokens == 300
    assert s.by_model["claude-haiku-4"].prompt_tokens == 300


def test_cost_aggregated_correctly() -> None:
    tracker = UsageTracker(run_id="run-004")
    u1 = TokenUsage(prompt_tokens=1000, completion_tokens=500, total_tokens=1500)
    tracker.record("node-x", "openai", "gpt-4o-mini", u1)
    expected_cost = (1000 / 1000) * 0.00015 + (500 / 1000) * 0.0006
    s = tracker.summary
    assert s.total_cost_usd == pytest.approx(expected_cost)


def test_call_count_increments() -> None:
    tracker = UsageTracker(run_id="run-005")
    u = TokenUsage(prompt_tokens=10, completion_tokens=5, total_tokens=15)
    tracker.record("n1", "openai", "gpt-4o-mini", u)
    tracker.record("n2", "openai", "gpt-4o-mini", u)
    assert tracker.call_count == 2


def test_totals_property() -> None:
    tracker = UsageTracker(run_id="run-006")
    u = TokenUsage(prompt_tokens=50, completion_tokens=25, total_tokens=75)
    tracker.record("n1", "openai", "gpt-4o-mini", u)
    assert tracker.totals.prompt_tokens == 50
    assert tracker.totals.completion_tokens == 25


def test_reset_clears_everything() -> None:
    tracker = UsageTracker(run_id="run-007")
    u = TokenUsage(prompt_tokens=100, completion_tokens=50, total_tokens=150)
    tracker.record("n1", "openai", "gpt-4o-mini", u)
    tracker.reset()
    assert tracker.call_count == 0
    s = tracker.summary
    assert s.total_input_tokens == 0
    assert s.by_node == {}


def test_to_dict_has_expected_structure() -> None:
    tracker = UsageTracker(run_id="run-008")
    u1 = TokenUsage(prompt_tokens=100, completion_tokens=50, total_tokens=150)
    u2 = TokenUsage(prompt_tokens=200, completion_tokens=100, total_tokens=300)
    tracker.record("node-a", "openai", "gpt-4o-mini", u1)
    tracker.record("node-b", "anthropic", "claude-haiku-4", u2)

    d = tracker.to_dict()
    assert d["run_id"] == "run-008"
    assert d["call_count"] == 2
    assert "prompt_tokens" in d["totals"]
    assert "node-a" in d["by_node"]
    assert "openai" in d["by_provider"]
    assert "gpt-4o-mini" in d["by_model"]


def test_run_usage_to_dict() -> None:
    ru = RunUsage(
        run_id="test-run",
        total_input_tokens=100,
        total_output_tokens=50,
        total_cost_usd=0.001,
    )
    d = ru.to_dict()
    assert d["total_input_tokens"] == 100
    assert d["total_output_tokens"] == 50
    assert d["total_cost_usd"] == pytest.approx(0.001)
    assert d["by_node"] == {}
    assert d["by_provider"] == {}
    assert d["by_model"] == {}
