# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import asyncio

import pytest


@pytest.mark.anyio
async def test_memory_relay_is_not_distributed() -> None:
    from graph_caster.run_broker.relay.memory import MemoryRelay

    relay = MemoryRelay()
    assert relay.is_distributed is False


@pytest.mark.anyio
async def test_memory_relay_connect_disconnect() -> None:
    from graph_caster.run_broker.relay.memory import MemoryRelay

    relay = MemoryRelay()
    await relay.connect()
    await relay.disconnect()


@pytest.mark.anyio
async def test_memory_relay_publish_no_subscribers() -> None:
    from graph_caster.run_broker.relay import RelayMessage
    from graph_caster.run_broker.relay.memory import MemoryRelay

    relay = MemoryRelay()
    await relay.connect()
    msg = RelayMessage(run_id="run-1", channel="stdout", payload="hello")
    count = await relay.publish(msg)
    assert count == 0
    await relay.disconnect()


@pytest.mark.anyio
async def test_memory_relay_subscribe_receive_message() -> None:
    from graph_caster.run_broker.relay import RelayMessage
    from graph_caster.run_broker.relay.memory import MemoryRelay

    relay = MemoryRelay()
    await relay.connect()

    received: list[RelayMessage] = []

    async def reader() -> None:
        async for msg in relay.subscribe("run-1"):
            received.append(msg)
            if msg.channel == "exit":
                break

    task = asyncio.create_task(reader())
    await asyncio.sleep(0.01)

    msg1 = RelayMessage(run_id="run-1", channel="stdout", payload="line1")
    msg2 = RelayMessage(run_id="run-1", channel="exit", payload='{"code": 0}')

    count1 = await relay.publish(msg1)
    count2 = await relay.publish(msg2)

    await asyncio.wait_for(task, timeout=1.0)

    assert count1 == 1
    assert count2 == 1
    assert len(received) == 2
    assert received[0].payload == "line1"
    assert received[1].channel == "exit"

    await relay.disconnect()


@pytest.mark.anyio
async def test_memory_relay_multiple_subscribers() -> None:
    from graph_caster.run_broker.relay import RelayMessage
    from graph_caster.run_broker.relay.memory import MemoryRelay

    relay = MemoryRelay()
    await relay.connect()

    received1: list[RelayMessage] = []
    received2: list[RelayMessage] = []

    async def reader1() -> None:
        async for msg in relay.subscribe("run-1"):
            received1.append(msg)
            if msg.channel == "exit":
                break

    async def reader2() -> None:
        async for msg in relay.subscribe("run-1"):
            received2.append(msg)
            if msg.channel == "exit":
                break

    task1 = asyncio.create_task(reader1())
    task2 = asyncio.create_task(reader2())
    await asyncio.sleep(0.01)

    msg = RelayMessage(run_id="run-1", channel="exit", payload="done")
    count = await relay.publish(msg)

    await asyncio.wait_for(asyncio.gather(task1, task2), timeout=1.0)

    assert count == 2
    assert len(received1) == 1
    assert len(received2) == 1

    await relay.disconnect()


@pytest.mark.anyio
async def test_memory_relay_unsubscribe() -> None:
    from graph_caster.run_broker.relay import RelayMessage
    from graph_caster.run_broker.relay.memory import MemoryRelay

    relay = MemoryRelay()
    await relay.connect()

    received: list[RelayMessage] = []

    async def reader() -> None:
        async for msg in relay.subscribe("run-1"):
            received.append(msg)
            await relay.unsubscribe("run-1")
            break

    task = asyncio.create_task(reader())
    await asyncio.sleep(0.01)

    msg1 = RelayMessage(run_id="run-1", channel="stdout", payload="msg1")
    await relay.publish(msg1)

    await asyncio.wait_for(task, timeout=1.0)

    msg2 = RelayMessage(run_id="run-1", channel="stdout", payload="msg2")
    count = await relay.publish(msg2)

    assert count == 0
    assert len(received) == 1

    await relay.disconnect()


@pytest.mark.anyio
async def test_memory_relay_different_runs() -> None:
    from graph_caster.run_broker.relay import RelayMessage
    from graph_caster.run_broker.relay.memory import MemoryRelay

    relay = MemoryRelay()
    await relay.connect()

    received_run1: list[RelayMessage] = []
    received_run2: list[RelayMessage] = []

    async def reader1() -> None:
        async for msg in relay.subscribe("run-1"):
            received_run1.append(msg)
            if msg.channel == "exit":
                break

    async def reader2() -> None:
        async for msg in relay.subscribe("run-2"):
            received_run2.append(msg)
            if msg.channel == "exit":
                break

    task1 = asyncio.create_task(reader1())
    task2 = asyncio.create_task(reader2())
    await asyncio.sleep(0.01)

    msg_run1 = RelayMessage(run_id="run-1", channel="exit", payload="exit1")
    msg_run2 = RelayMessage(run_id="run-2", channel="exit", payload="exit2")

    await relay.publish(msg_run1)
    await relay.publish(msg_run2)

    await asyncio.wait_for(asyncio.gather(task1, task2), timeout=1.0)

    assert len(received_run1) == 1
    assert len(received_run2) == 1
    assert received_run1[0].payload == "exit1"
    assert received_run2[0].payload == "exit2"

    await relay.disconnect()
