# Copyright Aura. All Rights Reserved.

"""Redis helpers for **SET NX EX** lease locks (holder token + TTL)."""

from __future__ import annotations

from typing import Any

_RELEASE_IF_MATCH = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
return 0
"""


def redis_try_acquire_lock(
    client: Any,
    key: str,
    token: str,
    *,
    ttl_sec: int,
) -> bool:
    """
    ``SET key token NX EX ttl_sec``. Returns **True** if this client holds the lease.
    ``client`` must use **decode_responses=True** for string compare in Lua release.
    """
    if ttl_sec < 1:
        raise ValueError("ttl_sec must be >= 1")
    ok = client.set(key, token, nx=True, ex=int(ttl_sec))
    return bool(ok)


def redis_release_lock_if_token(client: Any, key: str, token: str) -> bool:
    """Delete **key** only if value equals **token**; returns **True** if deleted."""
    n = client.eval(_RELEASE_IF_MATCH, 1, key, token)
    return bool(n)
