# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import asyncio
import json
import logging
from typing import TYPE_CHECKING

from .base import EventRelay, RelayMessage

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from redis.asyncio import Redis
    from redis.asyncio.client import PubSub

logger = logging.getLogger(__name__)


def _channel_name(run_id: str) -> str:
    """Generate Redis channel name for a run."""
    return f"gc:run:{run_id}"


class RedisRelay(EventRelay):
    """Redis pub/sub event relay for multi-instance deployments."""

    def __init__(
        self,
        redis_client: Redis[bytes],
        instance_id: str = "",
    ) -> None:
        self._redis = redis_client
        self._instance_id = instance_id
        self._pubsubs: dict[str, PubSub] = {}
        self._connected = False

    async def connect(self) -> None:
        await self._redis.ping()
        self._connected = True
        logger.info("RedisRelay connected, instance=%s", self._instance_id)

    async def disconnect(self) -> None:
        for pubsub in list(self._pubsubs.values()):
            try:
                await pubsub.close()
            except Exception:
                pass
        self._pubsubs.clear()
        self._connected = False
        logger.info("RedisRelay disconnected")

    async def publish(self, message: RelayMessage) -> int:
        if message.instance_id == "":
            message = RelayMessage(
                run_id=message.run_id,
                channel=message.channel,
                payload=message.payload,
                instance_id=self._instance_id,
                timestamp=message.timestamp,
            )
        channel = _channel_name(message.run_id)
        data = json.dumps(message.to_dict())
        count = await self._redis.publish(channel, data)
        return count

    async def subscribe(self, run_id: str) -> AsyncIterator[RelayMessage]:
        channel = _channel_name(run_id)
        pubsub = self._redis.pubsub()
        await pubsub.subscribe(channel)
        self._pubsubs[run_id] = pubsub
        try:
            while True:
                raw = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
                if raw is None:
                    await asyncio.sleep(0.01)
                    continue
                if raw["type"] != "message":
                    continue
                data = raw["data"]
                if isinstance(data, bytes):
                    data = data.decode("utf-8")
                try:
                    obj = json.loads(data)
                    msg = RelayMessage.from_dict(obj)
                    yield msg
                except (json.JSONDecodeError, KeyError) as e:
                    logger.warning("Invalid relay message: %s", e)
        finally:
            await self._cleanup_pubsub(run_id, pubsub)

    async def _cleanup_pubsub(self, run_id: str, pubsub: PubSub) -> None:
        try:
            await pubsub.unsubscribe(_channel_name(run_id))
            await pubsub.close()
        except Exception:
            pass
        self._pubsubs.pop(run_id, None)

    async def unsubscribe(self, run_id: str) -> None:
        pubsub = self._pubsubs.pop(run_id, None)
        if pubsub:
            try:
                await pubsub.unsubscribe(_channel_name(run_id))
                await pubsub.close()
            except Exception:
                pass

    @property
    def is_distributed(self) -> bool:
        return True
