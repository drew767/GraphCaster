# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from graph_caster.delay_wait_exec import parse_duration_sec, parse_wait_for_file_params


def test_parse_duration_sec_positive() -> None:
    assert parse_duration_sec({"durationSec": 1.5}) == 1.5
    assert parse_duration_sec({"durationSec": "2"}) == 2.0


def test_parse_duration_sec_missing_or_invalid() -> None:
    assert parse_duration_sec({}) is None
    assert parse_duration_sec({"durationSec": None}) is None
    assert parse_duration_sec({"durationSec": 0}) is None
    assert parse_duration_sec({"durationSec": -1}) is None
    assert parse_duration_sec({"durationSec": "x"}) is None


def test_parse_duration_sec_caps() -> None:
    assert parse_duration_sec({"durationSec": 999_999}) == 86400.0


def test_parse_wait_for_file_params_defaults() -> None:
    t, p = parse_wait_for_file_params({"path": "x"})
    assert t == 300.0
    assert p == 0.25


def test_parse_wait_for_file_params_custom() -> None:
    t, p = parse_wait_for_file_params(
        {"path": "a", "timeoutSec": 60, "pollIntervalSec": 1.0},
    )
    assert t == 60.0
    assert p == 1.0


def test_parse_wait_for_file_params_invalid_timeout() -> None:
    assert parse_wait_for_file_params({"timeoutSec": 0}) is None
    assert parse_wait_for_file_params({"timeoutSec": "nope"}) is None


def test_parse_wait_for_file_params_poll_clamped() -> None:
    _, p_low = parse_wait_for_file_params({"path": "a", "pollIntervalSec": 0.001})
    assert p_low == 0.05
    _, p_high = parse_wait_for_file_params({"path": "a", "pollIntervalSec": 100})
    assert p_high == 10.0
