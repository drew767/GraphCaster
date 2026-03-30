# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from graph_caster.run_broker.redis_coord import (
    global_active_workers_gauge,
    redis_coord_config,
    release_global_run_slot,
    try_acquire_global_run_slot,
)


def test_config_none_without_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GC_RUN_BROKER_REDIS_URL", raising=False)
    assert redis_coord_config() is None
    assert try_acquire_global_run_slot() is True
    release_global_run_slot()


def test_acquire_release_lua(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_RUN_BROKER_REDIS_URL", "redis://127.0.0.1:63799/0")
    monkeypatch.setenv("GC_RUN_BROKER_REDIS_GLOBAL_MAX_RUNS", "3")
    mock_r = MagicMock()
    mock_r.eval.side_effect = [1, 1, 0, 1, 1]

    with patch("graph_caster.run_broker.redis_coord._redis_client", return_value=mock_r):
        assert try_acquire_global_run_slot() is True
        assert try_acquire_global_run_slot() is True
        assert try_acquire_global_run_slot() is False
        release_global_run_slot()
        release_global_run_slot()
        assert mock_r.eval.call_count == 5

    cfg = redis_coord_config()
    assert cfg is not None
    assert cfg.global_limit == 3
    assert cfg.counter_key.endswith("global_active_workers")


def test_global_gauge(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_RUN_BROKER_REDIS_URL", "redis://x/0")
    mock_r = MagicMock()
    mock_r.get.return_value = b"4"
    with patch("graph_caster.run_broker.redis_coord._redis_client", return_value=mock_r):
        assert global_active_workers_gauge() == 4
