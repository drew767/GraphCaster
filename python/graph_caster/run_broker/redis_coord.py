# Copyright GraphCaster. All Rights Reserved.

"""Optional **cluster-wide** cap on concurrent child workers via Redis (multi-broker)."""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from typing import Any

_LOG = logging.getLogger(__name__)

_LUA_TRY_ACQUIRE = """
local cur = tonumber(redis.call('GET', KEYS[1]) or '0')
local lim = tonumber(ARGV[1])
if cur >= lim then return 0 end
redis.call('INCR', KEYS[1])
return 1
"""

_LUA_RELEASE = """
local cur = tonumber(redis.call('GET', KEYS[1]) or '0')
if cur < 1 then return 0 end
redis.call('DECR', KEYS[1])
return 1
"""

_client: Any | None = None
_client_url: str | None = None


@dataclass(frozen=True)
class RedisCoordConfig:
    url: str
    counter_key: str
    global_limit: int


def _broker_max_runs_env() -> int:
    raw = os.environ.get("GC_RUN_BROKER_MAX_RUNS", "2").strip()
    try:
        n = int(raw)
    except ValueError:
        return 2
    return max(1, min(32, n))


def redis_coord_config() -> RedisCoordConfig | None:
    url = os.environ.get("GC_RUN_BROKER_REDIS_URL", "").strip()
    if not url:
        return None
    raw_p = os.environ.get("GC_RUN_BROKER_REDIS_KEY_PREFIX", "").strip()
    prefix = raw_p if raw_p else "graph_caster:run_broker:"
    if not prefix.endswith(":"):
        prefix = prefix + ":"
    key = f"{prefix}global_active_workers"
    raw_g = os.environ.get("GC_RUN_BROKER_REDIS_GLOBAL_MAX_RUNS", "").strip()
    if raw_g:
        try:
            lim = max(1, min(512, int(raw_g)))
        except ValueError:
            lim = _broker_max_runs_env()
    else:
        lim = _broker_max_runs_env()
    return RedisCoordConfig(url=url, counter_key=key, global_limit=lim)


def _redis_client(url: str) -> Any:
    global _client, _client_url
    try:
        import redis  # type: ignore[import-untyped]
    except ImportError as e:
        raise RuntimeError(
            "GC_RUN_BROKER_REDIS_URL is set but redis is not installed; "
            "pip install -e \".[redis]\" or pip install redis"
        ) from e
    if _client is None or _client_url != url:
        _client = redis.Redis.from_url(url, decode_responses=False)
        _client_url = url
    return _client


def try_acquire_global_run_slot() -> bool:
    """Return **True** if this broker may start another child process (Redis or disabled)."""
    cfg = redis_coord_config()
    if cfg is None:
        return True
    try:
        r = _redis_client(cfg.url)
        ok = r.eval(_LUA_TRY_ACQUIRE, 1, cfg.counter_key, str(cfg.global_limit))
        return bool(ok)
    except Exception as e:
        if os.environ.get("GC_RUN_BROKER_REDIS_STRICT", "").strip() == "1":
            _LOG.warning("GC_RUN_BROKER_REDIS_STRICT: global slot acquire failed: %s", e)
            return False
        _LOG.warning("Redis unavailable; global concurrent cap not enforced: %s", e)
        return True


def release_global_run_slot() -> None:
    cfg = redis_coord_config()
    if cfg is None:
        return
    try:
        r = _redis_client(cfg.url)
        r.eval(_LUA_RELEASE, 1, cfg.counter_key)
    except Exception:
        _LOG.debug("Redis global slot release failed", exc_info=True)


def global_active_workers_gauge() -> int | None:
    """Current Redis counter (``None`` if Redis coordination disabled or unreadable)."""
    cfg = redis_coord_config()
    if cfg is None:
        return None
    try:
        r = _redis_client(cfg.url)
        raw = r.get(cfg.counter_key)
        if raw is None:
            return 0
        return int(raw)
    except Exception:
        return None
