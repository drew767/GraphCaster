# Copyright GraphCaster. All Rights Reserved.

"""Synchronous Redis publish hook for :class:`~graph_caster.run_broker.broadcaster.RunBroadcaster`.

When ``GC_RUN_BROKER_REDIS_URL`` is set and ``GC_RUN_BROKER_EVENT_RELAY`` is not disabled,
each fan-out message is also published on ``gc:run:{run_id}`` so other processes can
subscribe (see :class:`~graph_caster.run_broker.relay.redis_relay.RedisRelay`).
"""

from __future__ import annotations

import json
import logging
import os
import socket
import threading
from collections.abc import Callable

from graph_caster.run_broker.broadcaster import FanOutMsg
from graph_caster.run_broker.relay.base import RelayMessage

_LOG = logging.getLogger(__name__)

_client_lock = threading.Lock()
_sync_client: object | None = None
_client_url: str | None = None


def _broker_instance_id() -> str:
    raw = os.environ.get("GC_RUN_BROKER_INSTANCE_ID", "").strip()
    if raw:
        return raw
    try:
        return socket.gethostname() or "unknown"
    except OSError:
        return "unknown"


def _event_relay_enabled() -> bool:
    if not os.environ.get("GC_RUN_BROKER_REDIS_URL", "").strip():
        return False
    flag = os.environ.get("GC_RUN_BROKER_EVENT_RELAY", "1").strip().lower()
    return flag not in ("0", "false", "no")


def _get_sync_redis(url: str):
    global _sync_client, _client_url
    try:
        import redis  # type: ignore[import-untyped]
    except ImportError as e:
        raise RuntimeError(
            "GC_RUN_BROKER_REDIS_URL is set for event relay but redis is not installed"
        ) from e
    with _client_lock:
        if _sync_client is None or _client_url != url:
            _sync_client = redis.Redis.from_url(url, decode_responses=True)
            _client_url = url
        return _sync_client


def _channel(run_id: str) -> str:
    return f"gc:run:{run_id}"


def fanout_to_relay_message(run_id: str, msg: FanOutMsg, instance_id: str) -> RelayMessage:
    if msg.kind == "out":
        return RelayMessage(
            run_id=run_id,
            channel="stdout",
            payload=str(msg.payload),
            instance_id=instance_id,
        )
    if msg.kind == "err":
        return RelayMessage(
            run_id=run_id,
            channel="stderr",
            payload=str(msg.payload),
            instance_id=instance_id,
        )
    if msg.kind == "exit":
        return RelayMessage(
            run_id=run_id,
            channel="exit",
            payload=json.dumps({"code": int(msg.payload)}),
            instance_id=instance_id,
        )
    return RelayMessage(
        run_id=run_id,
        channel="control",
        payload=str(msg.payload),
        instance_id=instance_id,
    )


def relay_fanout_hook_for_run(run_id: str) -> Callable[[FanOutMsg], None] | None:
    """Build a hook for :meth:`RunBroadcaster.broadcast`, or ``None`` if relay publish is off."""
    if not _event_relay_enabled():
        return None
    url = os.environ.get("GC_RUN_BROKER_REDIS_URL", "").strip()
    iid = _broker_instance_id()

    def _hook(msg: FanOutMsg) -> None:
        try:
            r = _get_sync_redis(url)
            rm = fanout_to_relay_message(run_id, msg, iid)
            r.publish(_channel(run_id), json.dumps(rm.to_dict()))
        except Exception:
            if os.environ.get("GC_RUN_BROKER_EVENT_RELAY_STRICT", "").strip() == "1":
                raise
            _LOG.debug("Redis event relay publish failed (non-fatal)", exc_info=True)

    return _hook
