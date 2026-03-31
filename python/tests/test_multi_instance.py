# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from importlib.util import find_spec
from unittest.mock import MagicMock

import pytest

from graph_caster.scaling.instance_registry import InstanceRegistry
from graph_caster.scaling.leader_election import RedisLeaderElection


@pytest.mark.skipif(find_spec("redis") is None, reason="redis optional")
def test_leader_try_acquire(monkeypatch: pytest.MonkeyPatch) -> None:
    import redis as redis_mod

    fake = MagicMock()
    fake.set.return_value = True
    monkeypatch.setattr(redis_mod, "Redis", MagicMock(from_url=lambda _u: fake))
    el = RedisLeaderElection("redis://localhost:6379/0")
    assert el.try_acquire("my-token") is True
    args, _kwargs = fake.set.call_args
    assert args[0] == "gc:scaling:leader" and args[1] == "my-token"


@pytest.mark.skipif(find_spec("redis") is None, reason="redis optional")
def test_instance_registry_heartbeat(monkeypatch: pytest.MonkeyPatch) -> None:
    import redis as redis_mod

    fake = MagicMock()
    monkeypatch.setattr(redis_mod, "Redis", MagicMock(from_url=lambda _u: fake))
    reg = InstanceRegistry("redis://localhost:6379/0")
    reg.heartbeat("i1", {"host": "a"})
    fake.setex.assert_called_once()
