# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import asyncio
import os

import pytest

try:
    import redis.asyncio as aioredis

    HAS_REDIS = True
except ImportError:
    HAS_REDIS = False

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/15")

pytestmark = [
    pytest.mark.anyio,
    pytest.mark.skipif(not HAS_REDIS, reason="redis package not installed"),
]


@pytest.fixture
async def redis_client():
    if not HAS_REDIS:
        pytest.skip("redis not installed")
    client = aioredis.from_url(REDIS_URL)
    try:
        await client.ping()
    except Exception:
        pytest.skip("Redis server not available")
    try:
        yield client
    finally:
        await client.aclose()


async def test_redis_relay_is_distributed(redis_client) -> None:
    from graph_caster.run_broker.relay.redis_relay import RedisRelay

    relay = RedisRelay(redis_client, instance_id="test-inst")
    assert relay.is_distributed is True


async def test_redis_relay_connect_disconnect(redis_client) -> None:
    from graph_caster.run_broker.relay.redis_relay import RedisRelay

    relay = RedisRelay(redis_client, instance_id="test-inst")
    await relay.connect()
    await relay.disconnect()


async def test_redis_relay_publish_no_subscribers(redis_client) -> None:
    from graph_caster.run_broker.relay import RelayMessage
    from graph_caster.run_broker.relay.redis_relay import RedisRelay

    relay = RedisRelay(redis_client, instance_id="test-inst")
    await relay.connect()
    msg = RelayMessage(run_id="test-run-1", channel="stdout", payload="hello")
    count = await relay.publish(msg)
    assert count == 0
    await relay.disconnect()


async def test_redis_relay_subscribe_receive_message(redis_client) -> None:
    from graph_caster.run_broker.relay import RelayMessage
    from graph_caster.run_broker.relay.redis_relay import RedisRelay

    relay = RedisRelay(redis_client, instance_id="publisher")
    await relay.connect()

    received: list[RelayMessage] = []

    async def reader() -> None:
        async for msg in relay.subscribe("test-run-2"):
            received.append(msg)
            if msg.channel == "exit":
                break

    task = asyncio.create_task(reader())
    await asyncio.sleep(0.1)

    msg1 = RelayMessage(run_id="test-run-2", channel="stdout", payload="line1")
    msg2 = RelayMessage(run_id="test-run-2", channel="exit", payload='{"code": 0}')

    count1 = await relay.publish(msg1)
    await asyncio.sleep(0.05)
    count2 = await relay.publish(msg2)

    await asyncio.wait_for(task, timeout=3.0)

    assert count1 >= 1
    assert count2 >= 1
    assert len(received) == 2
    assert received[0].payload == "line1"
    assert received[1].channel == "exit"
    assert received[0].instance_id == "publisher"

    await relay.disconnect()


async def test_redis_relay_cross_instance(redis_client) -> None:
    from graph_caster.run_broker.relay import RelayMessage
    from graph_caster.run_broker.relay.redis_relay import RedisRelay

    relay1 = RedisRelay(redis_client, instance_id="instance-a")
    relay2 = RedisRelay(redis_client, instance_id="instance-b")
    await relay1.connect()
    await relay2.connect()

    received: list[RelayMessage] = []

    async def reader() -> None:
        async for msg in relay2.subscribe("cross-run"):
            received.append(msg)
            if msg.channel == "exit":
                break

    task = asyncio.create_task(reader())
    await asyncio.sleep(0.1)

    msg = RelayMessage(run_id="cross-run", channel="exit", payload="done")
    await relay1.publish(msg)

    await asyncio.wait_for(task, timeout=3.0)

    assert len(received) == 1
    assert received[0].instance_id == "instance-a"

    await relay1.disconnect()
    await relay2.disconnect()


async def test_redis_relay_unsubscribe(redis_client) -> None:
    from graph_caster.run_broker.relay import RelayMessage
    from graph_caster.run_broker.relay.redis_relay import RedisRelay

    relay = RedisRelay(redis_client, instance_id="test-inst")
    await relay.connect()

    received: list[RelayMessage] = []

    async def reader() -> None:
        async for msg in relay.subscribe("unsub-run"):
            received.append(msg)
            await relay.unsubscribe("unsub-run")
            break

    task = asyncio.create_task(reader())
    await asyncio.sleep(0.1)

    msg1 = RelayMessage(run_id="unsub-run", channel="stdout", payload="msg1")
    await relay.publish(msg1)

    try:
        await asyncio.wait_for(task, timeout=2.0)
    except asyncio.CancelledError:
        pass

    assert len(received) == 1

    await relay.disconnect()
