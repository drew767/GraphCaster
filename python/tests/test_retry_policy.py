# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import time

from graph_caster.runner.retry_policy import (
    circuit_is_open,
    circuit_on_failure,
    circuit_on_success,
    compute_retry_sleep_sec,
    parse_retry_policy,
)


def test_parse_retry_absent() -> None:
    assert parse_retry_policy({}) is None
    assert parse_retry_policy({"retry": False}) is None
    assert parse_retry_policy({"retryPolicy": False}) is None


def test_parse_retry_true_defaults() -> None:
    p = parse_retry_policy({"retry": True})
    assert p is not None
    assert p.max_attempts == 3
    assert p.initial_delay_sec == 1.0
    assert p.multiplier == 2.0


def test_parse_retry_int_attempts() -> None:
    p = parse_retry_policy({"retry": 5})
    assert p is not None
    assert p.max_attempts == 5


def test_parse_retry_policy_dict() -> None:
    p = parse_retry_policy(
        {
            "retryPolicy": {
                "maxAttempts": 2,
                "initialDelaySec": 0.5,
                "maxDelaySec": 10.0,
                "multiplier": 3.0,
                "jitter": False,
                "circuitBreaker": {"failureThreshold": 2, "cooldownSec": 1.5},
            }
        }
    )
    assert p is not None
    assert p.max_attempts == 2
    assert p.initial_delay_sec == 0.5
    assert p.circuit_failure_threshold == 2
    assert p.circuit_cooldown_sec == 1.5


def test_compute_retry_sleep_exponential() -> None:
    from graph_caster.runner.retry_policy import RetryPolicyParsed

    pol = RetryPolicyParsed(
        max_attempts=4,
        initial_delay_sec=1.0,
        max_delay_sec=100.0,
        multiplier=2.0,
        jitter=False,
        circuit_failure_threshold=0,
        circuit_cooldown_sec=30.0,
    )
    assert compute_retry_sleep_sec(pol, 0) == 1.0
    assert compute_retry_sleep_sec(pol, 1) == 2.0


def test_circuit_opens_after_threshold() -> None:
    from graph_caster.runner.retry_policy import RetryPolicyParsed

    pol = RetryPolicyParsed(
        max_attempts=5,
        initial_delay_sec=0.01,
        max_delay_sec=1.0,
        multiplier=2.0,
        jitter=False,
        circuit_failure_threshold=2,
        circuit_cooldown_sec=0.2,
    )
    ctx: dict = {}
    assert not circuit_is_open(ctx, "n1", pol)
    circuit_on_failure(ctx, "n1", pol)
    assert not circuit_is_open(ctx, "n1", pol)
    circuit_on_failure(ctx, "n1", pol)
    assert circuit_is_open(ctx, "n1", pol)
    circuit_on_success(ctx, "n1", pol)
    assert not circuit_is_open(ctx, "n1", pol)


def test_circuit_cooldown_expires() -> None:
    from graph_caster.runner.retry_policy import RetryPolicyParsed

    pol = RetryPolicyParsed(
        max_attempts=5,
        initial_delay_sec=0.01,
        max_delay_sec=1.0,
        multiplier=2.0,
        jitter=False,
        circuit_failure_threshold=1,
        circuit_cooldown_sec=0.05,
    )
    ctx: dict = {}
    circuit_on_failure(ctx, "n1", pol)
    assert circuit_is_open(ctx, "n1", pol)
    time.sleep(0.08)
    assert not circuit_is_open(ctx, "n1", pol)
