# Copyright GraphCaster. All Rights Reserved.

"""Redis instance heartbeat registry (optional ``scaling`` extra)."""

from __future__ import annotations

import json
from typing import Any


class InstanceRegistry:
    def __init__(self, redis_url: str, key_prefix: str = "gc:instance:", ttl_sec: int = 30) -> None:
        try:
            from redis import Redis
        except ImportError as e:
            raise RuntimeError("InstanceRegistry requires pip install -e '.[scaling]'") from e
        self._r: Any = Redis.from_url(redis_url)
        self._prefix = key_prefix
        self._ttl = max(5, int(ttl_sec))

    def heartbeat(self, instance_id: str, meta: dict[str, Any]) -> None:
        key = f"{self._prefix}{instance_id}"
        line = json.dumps(meta, ensure_ascii=False, separators=(",", ":"))
        self._r.setex(key, self._ttl, line)

    def read(self, instance_id: str) -> dict[str, Any] | None:
        raw = self._r.get(f"{self._prefix}{instance_id}")
        if raw is None:
            return None
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8", errors="replace")
        try:
            out = json.loads(str(raw))
        except json.JSONDecodeError:
            return None
        return out if isinstance(out, dict) else None
