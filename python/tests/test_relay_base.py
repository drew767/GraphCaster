# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations


def test_relay_base_imports() -> None:
    from graph_caster.run_broker.relay import EventRelay, RelayMessage

    assert hasattr(EventRelay, "connect")
    assert hasattr(EventRelay, "disconnect")
    assert hasattr(EventRelay, "publish")
    assert hasattr(EventRelay, "subscribe")
    assert hasattr(EventRelay, "unsubscribe")
    assert hasattr(EventRelay, "is_distributed")
    assert hasattr(RelayMessage, "to_dict")
    assert hasattr(RelayMessage, "from_dict")


def test_relay_message_to_dict() -> None:
    from graph_caster.run_broker.relay import RelayMessage

    msg = RelayMessage(
        run_id="r1",
        channel="stdout",
        payload="test line",
        instance_id="inst-1",
        timestamp=1234567890.5,
    )
    d = msg.to_dict()
    assert d["runId"] == "r1"
    assert d["channel"] == "stdout"
    assert d["payload"] == "test line"
    assert d["instanceId"] == "inst-1"
    assert d["timestamp"] == 1234567890.5


def test_relay_message_from_dict() -> None:
    from graph_caster.run_broker.relay import RelayMessage

    data = {
        "runId": "r2",
        "channel": "stderr",
        "payload": "error message",
        "instanceId": "inst-2",
        "timestamp": 9876543210.0,
    }
    msg = RelayMessage.from_dict(data)
    assert msg.run_id == "r2"
    assert msg.channel == "stderr"
    assert msg.payload == "error message"
    assert msg.instance_id == "inst-2"
    assert msg.timestamp == 9876543210.0


def test_relay_message_roundtrip() -> None:
    from graph_caster.run_broker.relay import RelayMessage

    original = RelayMessage(
        run_id="run-123",
        channel="exit",
        payload='{"code": 0}',
        instance_id="node-a",
        timestamp=1000.0,
    )
    d = original.to_dict()
    restored = RelayMessage.from_dict(d)
    assert restored.run_id == original.run_id
    assert restored.channel == original.channel
    assert restored.payload == original.payload
    assert restored.instance_id == original.instance_id
    assert restored.timestamp == original.timestamp


def test_relay_message_default_values() -> None:
    from graph_caster.run_broker.relay import RelayMessage

    msg = RelayMessage(run_id="r1", channel="stdout", payload="data")
    assert msg.instance_id == ""
    assert msg.timestamp > 0
