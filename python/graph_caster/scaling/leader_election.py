# Copyright GraphCaster. All Rights Reserved.

"""Redis leader lease (optional ``scaling`` extra)."""

from __future__ import annotations

from typing import Any


class RedisLeaderElection:
    def __init__(self, redis_url: str, key: str = "gc:scaling:leader", ttl_sec: int = 15) -> None:
        try:
            from redis import Redis
        except ImportError as e:
            raise RuntimeError("RedisLeaderElection requires pip install -e '.[scaling]'") from e
        self._r: Any = Redis.from_url(redis_url)
        self._key = key
        self._ttl = max(3, int(ttl_sec))

    def try_acquire(self, token: str) -> bool:
        ok = bool(self._r.set(self._key, token, nx=True, ex=self._ttl))
        return ok

    def refresh(self, token: str) -> bool:
        cur = self._r.get(self._key)
        if cur is None:
            return False
        if isinstance(cur, bytes):
            cur_s = cur.decode("utf-8", errors="replace")
        else:
            cur_s = str(cur)
        if cur_s != token:
            return False
        return bool(self._r.expire(self._key, self._ttl))

    def release(self, token: str) -> None:
        cur = self._r.get(self._key)
        if cur is None:
            return
        if isinstance(cur, bytes):
            cur_s = cur.decode("utf-8", errors="replace")
        else:
            cur_s = str(cur)
        if cur_s == token:
            self._r.delete(self._key)
