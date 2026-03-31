# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest

from graph_caster.run_broker.broadcaster import FanOutMsg, RunBroadcaster
from graph_caster.run_broker.relay.broker_sync import (
    fanout_to_relay_message,
    relay_fanout_hook_for_run,
)


def test_fanout_to_relay_message_stdout() -> None:
    m = fanout_to_relay_message("r1", FanOutMsg("out", '{"type":"x"}'), "i1")
    assert m.run_id == "r1"
    assert m.channel == "stdout"
    assert m.payload == '{"type":"x"}'
    assert m.instance_id == "i1"


def test_fanout_to_relay_message_exit() -> None:
    m = fanout_to_relay_message("r1", FanOutMsg("exit", 0), "i1")
    assert m.channel == "exit"
    assert json.loads(m.payload) == {"code": 0}


def test_run_broadcaster_calls_relay_hook() -> None:
    seen: list[FanOutMsg] = []

    def hook(msg: FanOutMsg) -> None:
        seen.append(msg)

    b = RunBroadcaster("run-z", relay_fanout_hook=hook)
    b.broadcast(FanOutMsg("out", "hello"))
    assert len(seen) == 1
    assert seen[0].kind == "out"


def test_relay_fanout_hook_publishes_when_redis_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("GC_RUN_BROKER_REDIS_URL", "redis://127.0.0.1:6379/0")
    monkeypatch.setenv("GC_RUN_BROKER_INSTANCE_ID", "test-inst")
    mock_r = MagicMock()
    with patch("graph_caster.run_broker.relay.broker_sync._get_sync_redis", return_value=mock_r):
        hook = relay_fanout_hook_for_run("run-abc")
        assert hook is not None
        hook(FanOutMsg("out", '{"type":"run_started"}'))
    mock_r.publish.assert_called_once()
    ch, payload = mock_r.publish.call_args[0]
    assert ch == "gc:run:run-abc"
    d = json.loads(payload)
    assert d["runId"] == "run-abc"
    assert d["channel"] == "stdout"
    assert d["instanceId"] == "test-inst"


def test_relay_fanout_hook_disabled_when_env_off(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_RUN_BROKER_REDIS_URL", "redis://127.0.0.1:6379/0")
    monkeypatch.setenv("GC_RUN_BROKER_EVENT_RELAY", "0")
    assert relay_fanout_hook_for_run("r") is None


def test_relay_fanout_hook_none_without_redis_url(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GC_RUN_BROKER_REDIS_URL", raising=False)
    assert relay_fanout_hook_for_run("r") is None
