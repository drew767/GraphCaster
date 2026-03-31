# Copyright GraphCaster. All Rights Reserved.

from .base import EventRelay, RelayMessage
from .memory import MemoryRelay

__all__ = ["EventRelay", "MemoryRelay", "RelayMessage"]


def get_redis_relay() -> type:
    """Lazy import of RedisRelay to avoid redis dependency when not needed."""
    from .redis_relay import RedisRelay

    return RedisRelay
