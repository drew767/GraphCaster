# Copyright GraphCaster. All Rights Reserved.

"""Retry with exponential backoff and optional per-node circuit breaker (run scope)."""

from __future__ import annotations

import random
import time
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class RetryPolicyParsed:
    max_attempts: int
    initial_delay_sec: float
    max_delay_sec: float
    multiplier: float
    jitter: bool
    circuit_failure_threshold: int
    circuit_cooldown_sec: float


def parse_retry_policy(data: dict[str, Any]) -> RetryPolicyParsed | None:
    raw = data.get("retryPolicy")
    if raw is None:
        r = data.get("retry")
        if r is True:
            return RetryPolicyParsed(
                max_attempts=3,
                initial_delay_sec=1.0,
                max_delay_sec=60.0,
                multiplier=2.0,
                jitter=False,
                circuit_failure_threshold=0,
                circuit_cooldown_sec=30.0,
            )
        if isinstance(r, int) and r > 1:
            return RetryPolicyParsed(
                max_attempts=max(2, r),
                initial_delay_sec=1.0,
                max_delay_sec=60.0,
                multiplier=2.0,
                jitter=False,
                circuit_failure_threshold=0,
                circuit_cooldown_sec=30.0,
            )
        return None
    if raw is False:
        return None
    if raw is True:
        return RetryPolicyParsed(
            max_attempts=3,
            initial_delay_sec=1.0,
            max_delay_sec=60.0,
            multiplier=2.0,
            jitter=False,
            circuit_failure_threshold=0,
            circuit_cooldown_sec=30.0,
        )
    if not isinstance(raw, dict):
        return None
    cb = raw.get("circuitBreaker") if isinstance(raw.get("circuitBreaker"), dict) else {}
    thr = int(cb.get("failureThreshold", 0) or 0)
    cool = float(cb.get("cooldownSec", 30) or 30)
    return RetryPolicyParsed(
        max_attempts=max(1, int(raw.get("maxAttempts", 3))),
        initial_delay_sec=max(0.0, float(raw.get("initialDelaySec", 1.0))),
        max_delay_sec=max(0.0, float(raw.get("maxDelaySec", 60.0))),
        multiplier=max(1.0, float(raw.get("multiplier", 2.0))),
        jitter=bool(raw.get("jitter", False)),
        circuit_failure_threshold=max(0, thr),
        circuit_cooldown_sec=max(0.0, cool),
    )


def compute_retry_sleep_sec(policy: RetryPolicyParsed, failed_attempt_index: int) -> float:
    """``failed_attempt_index`` 0 = sleep after first failure, before second attempt."""
    if policy.initial_delay_sec <= 0:
        return 0.0
    d = policy.initial_delay_sec * (policy.multiplier**failed_attempt_index)
    d = min(d, policy.max_delay_sec) if policy.max_delay_sec > 0 else d
    if policy.jitter and d > 0:
        d *= 0.5 + random.random() * 0.5
    return float(d)


def circuit_is_open(ctx: dict[str, Any], node_id: str, policy: RetryPolicyParsed) -> bool:
    if policy.circuit_failure_threshold <= 0:
        return False
    bucket: dict[str, Any] = ctx.get("_gc_retry_circuit") or {}
    st = bucket.get(node_id)
    if not isinstance(st, dict):
        return False
    until = float(st.get("open_until") or 0.0)
    return until > time.monotonic()


def circuit_on_success(ctx: dict[str, Any], node_id: str, policy: RetryPolicyParsed) -> None:
    if policy.circuit_failure_threshold <= 0:
        return
    bucket: dict[str, Any] = ctx.setdefault("_gc_retry_circuit", {})
    bucket[node_id] = {"fails": 0, "open_until": 0.0}


def circuit_on_failure(ctx: dict[str, Any], node_id: str, policy: RetryPolicyParsed) -> None:
    if policy.circuit_failure_threshold <= 0:
        return
    bucket = ctx.setdefault("_gc_retry_circuit", {})
    st: dict[str, Any] = dict(bucket.get(node_id) or {})
    fails = int(st.get("fails", 0)) + 1
    open_until = float(st.get("open_until") or 0.0)
    if fails >= policy.circuit_failure_threshold:
        open_until = time.monotonic() + policy.circuit_cooldown_sec
        fails = 0
    bucket[node_id] = {"fails": fails, "open_until": open_until}
