# Copyright Aura. All Rights Reserved.

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

# Configurable defaults
DEFAULT_POLL_TIMEOUT = 1.0
DEFAULT_POLL_INTERVAL = 0.01


def _channel_name(run_id: str) -> str:
    """Generate Redis channel name for a run."""
    return f"gc:run:{run_id}"


class RedisRelay(EventRelay):
    """Redis pub/sub event relay for multi-instance deployments.
    
    Uses Redis pub/sub to distribute messages across instances.
    Channel naming: gc:run:{run_id}
    """

    def __init__(
        self,
        redis_client: Redis[bytes],
        instance_id: str = "",
        poll_timeout: float = DEFAULT_POLL_TIMEOUT,
        poll_interval: float = DEFAULT_POLL_INTERVAL,
    ) -> None:
        self._redis = redis_client
        self._instance_id = instance_id
        self._pubsubs: dict[str, PubSub] = {}
        self._connected = False
        self._poll_timeout = poll_timeout
        self._poll_interval = poll_interval

    async def connect(self) -> None:
        """Connect to Redis and verify connection."""
        await self._redis.ping()
        self._connected = True
        logger.info("RedisRelay connected, instance=%s", self._instance_id)

    async def disconnect(self) -> None:
        """Disconnect from Redis and clean up all pubsub connections."""
        for run_id, pubsub in list(self._pubsubs.items()):
            try:
                await pubsub.close()
            except Exception as e:
                logger.debug("Error closing pubsub for run %s: %s", run_id, e)
        self._pubsubs.clear()
        self._connected = False
        logger.info("RedisRelay disconnected")

    async def publish(self, message: RelayMessage) -> int:
        """Publish message to Redis channel.
        
        Auto-fills instance_id if not set.
        Returns the number of subscribers that received the message.
        """
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
        """Subscribe to messages for a run via Redis pub/sub.
        
        Yields RelayMessage objects as they arrive.
        Invalid messages are logged and skipped.
        """
        channel = _channel_name(run_id)
        pubsub = self._redis.pubsub()
        await pubsub.subscribe(channel)
        self._pubsubs[run_id] = pubsub
        try:
            while True:
                raw = await pubsub.get_message(
                    ignore_subscribe_messages=True, 
                    timeout=self._poll_timeout
                )
                if raw is None:
                    await asyncio.sleep(self._poll_interval)
                    continue
                if raw["type"] != "message":
                    continue
                data = raw["data"]
                if isinstance(data, bytes):
                    data = data.decode("utf-8")
                try:
                    obj = json.loads(data)
                    if not isinstance(obj, dict):
                        logger.warning("Invalid relay message format: expected dict, got %s", type(obj).__name__)
                        continue
                    msg = RelayMessage.from_dict(obj)
                    yield msg
                except json.JSONDecodeError as e:
                    logger.warning("Invalid JSON in relay message: %s", e)
                except (KeyError, TypeError, AttributeError) as e:
                    logger.warning("Invalid relay message structure: %s", e)
        finally:
            await self._cleanup_pubsub(run_id, pubsub)

    async def _cleanup_pubsub(self, run_id: str, pubsub: PubSub) -> None:
        """Clean up a pubsub connection."""
        try:
            await pubsub.unsubscribe(_channel_name(run_id))
            await pubsub.close()
        except Exception as e:
            logger.debug("Error cleaning up pubsub for run %s: %s", run_id, e)
        self._pubsubs.pop(run_id, None)

    async def unsubscribe(self, run_id: str) -> None:
        """Unsubscribe from a run's messages."""
        pubsub = self._pubsubs.pop(run_id, None)
        if pubsub:
            try:
                await pubsub.unsubscribe(_channel_name(run_id))
                await pubsub.close()
            except Exception as e:
                logger.debug("Error unsubscribing from run %s: %s", run_id, e)

    @property
    def is_distributed(self) -> bool:
        """Returns True - Redis relay supports multi-instance."""
        return True
