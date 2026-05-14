# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from graph_caster.llm.provider import TokenUsage

_LOG = logging.getLogger(__name__)

try:
    import prometheus_client as _prom

    _gc_llm_input_tokens = _prom.Counter(
        "gc_llm_input_tokens_total",
        "Total LLM prompt tokens consumed",
        ["provider", "model"],
    )
    _gc_llm_output_tokens = _prom.Counter(
        "gc_llm_output_tokens_total",
        "Total LLM completion tokens consumed",
        ["provider", "model"],
    )
    _gc_llm_cost_usd = _prom.Counter(
        "gc_llm_cost_usd_total",
        "Total LLM cost in USD",
        ["provider", "model"],
    )
    _gc_llm_requests = _prom.Counter(
        "gc_llm_requests_total",
        "Total LLM requests",
        ["provider", "model", "status"],
    )
    _PROM_AVAILABLE = True
except Exception:
    _PROM_AVAILABLE = False


def _prom_record(
    provider: str,
    model: str,
    usage: TokenUsage,
    cost: float,
    status: str = "success",
) -> None:
    if not _PROM_AVAILABLE:
        return
    try:
        _gc_llm_input_tokens.labels(provider=provider, model=model).inc(usage.prompt_tokens)
        _gc_llm_output_tokens.labels(provider=provider, model=model).inc(usage.completion_tokens)
        _gc_llm_cost_usd.labels(provider=provider, model=model).inc(cost)
        _gc_llm_requests.labels(provider=provider, model=model, status=status).inc()
    except Exception:
        _LOG.debug("prometheus: failed to record llm metrics", exc_info=True)


@dataclass
class RunUsage:
    run_id: str
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    total_cost_usd: float = 0.0
    by_node: dict[str, TokenUsage] = field(default_factory=dict)
    by_provider: dict[str, TokenUsage] = field(default_factory=dict)
    by_model: dict[str, TokenUsage] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "total_input_tokens": self.total_input_tokens,
            "total_output_tokens": self.total_output_tokens,
            "total_cost_usd": self.total_cost_usd,
            "by_node": {k: v.to_dict() for k, v in self.by_node.items()},
            "by_provider": {k: v.to_dict() for k, v in self.by_provider.items()},
            "by_model": {k: v.to_dict() for k, v in self.by_model.items()},
        }


def _add_to(bucket: dict[str, TokenUsage], key: str, usage: TokenUsage) -> None:
    if key not in bucket:
        bucket[key] = TokenUsage()
    bucket[key].prompt_tokens += usage.prompt_tokens
    bucket[key].completion_tokens += usage.completion_tokens
    bucket[key].total_tokens += usage.total_tokens


class UsageTracker:
    """Accumulates token usage across multiple chat calls.

    Extends the F50 base with per-run breakdown (node / provider / model)
    and cost tracking via the pricing module.
    """

    def __init__(self, run_id: str = "") -> None:
        self._run_id = run_id
        self._totals = TokenUsage()
        self._call_count = 0
        self._total_cost_usd: float = 0.0
        self._by_node: dict[str, TokenUsage] = {}
        self._by_provider: dict[str, TokenUsage] = {}
        self._by_model: dict[str, TokenUsage] = {}

    def record(
        self,
        node_id: str,
        provider: str,
        model: str,
        usage: TokenUsage,
        *,
        status: str = "success",
    ) -> None:
        """Record usage for a single LLM call.

        Also accepts the legacy single-arg signature ``record(usage)`` for
        backward-compatibility with the F50 API.
        """
        from graph_caster.llm.pricing import compute_cost

        cost = compute_cost(usage, provider, model)
        self._totals.prompt_tokens += usage.prompt_tokens
        self._totals.completion_tokens += usage.completion_tokens
        self._totals.total_tokens += usage.total_tokens
        self._total_cost_usd += cost
        self._call_count += 1
        _add_to(self._by_node, node_id, usage)
        _add_to(self._by_provider, provider, usage)
        _add_to(self._by_model, model, usage)
        _prom_record(provider, model, usage, cost, status)

    @property
    def totals(self) -> TokenUsage:
        return self._totals

    @property
    def call_count(self) -> int:
        return self._call_count

    def reset(self) -> None:
        self._totals = TokenUsage()
        self._call_count = 0
        self._total_cost_usd = 0.0
        self._by_node.clear()
        self._by_provider.clear()
        self._by_model.clear()

    @property
    def summary(self) -> RunUsage:
        return RunUsage(
            run_id=self._run_id,
            total_input_tokens=self._totals.prompt_tokens,
            total_output_tokens=self._totals.completion_tokens,
            total_cost_usd=self._total_cost_usd,
            by_node=dict(self._by_node),
            by_provider=dict(self._by_provider),
            by_model=dict(self._by_model),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "run_id": self._run_id,
            "call_count": self._call_count,
            "totals": self._totals.to_dict(),
            "total_cost_usd": self._total_cost_usd,
            "by_node": {k: v.to_dict() for k, v in self._by_node.items()},
            "by_provider": {k: v.to_dict() for k, v in self._by_provider.items()},
            "by_model": {k: v.to_dict() for k, v in self._by_model.items()},
        }
