# Copyright GraphCaster. All Rights Reserved.

"""Atomic CAS and type-tagged key-normalization tests for ``node_output_cache``."""

from __future__ import annotations

import threading

from graph_caster.node_output_cache import (
    StepCacheStore,
    compute_step_cache_key,
    node_data_for_cache_key,
)


# ---------------------------------------------------------------------------
# Type-tag fix: tuples vs lists, sets vs strings no longer collide.
# ---------------------------------------------------------------------------


def test_tuple_vs_list_no_longer_collides() -> None:
    """Previously ``json.dumps`` round-tripped tuples to lists so identical hashes resulted."""
    k_tuple = compute_step_cache_key(
        graph_rev="r",
        graph_id="g",
        node_id="n",
        node_data={"items": (1, 2, 3)},
        upstream_outputs={"s": {"nodeType": "start", "data": {}}},
    )
    k_list = compute_step_cache_key(
        graph_rev="r",
        graph_id="g",
        node_id="n",
        node_data={"items": [1, 2, 3]},
        upstream_outputs={"s": {"nodeType": "start", "data": {}}},
    )
    assert k_tuple != k_list


def test_set_vs_string_no_longer_collides() -> None:
    """Set ``default=str`` coercion previously produced the same wire form as a literal string."""
    k_set = compute_step_cache_key(
        graph_rev="r",
        graph_id="g",
        node_id="n",
        node_data={"tags": {"a", "b"}},
        upstream_outputs={"s": {"nodeType": "start", "data": {}}},
    )
    k_str = compute_step_cache_key(
        graph_rev="r",
        graph_id="g",
        node_id="n",
        node_data={"tags": "{'a', 'b'}"},
        upstream_outputs={"s": {"nodeType": "start", "data": {}}},
    )
    assert k_set != k_str


def test_set_key_is_order_independent() -> None:
    """Tagged set form is sorted so insertion order does not change the hash."""
    a = node_data_for_cache_key({"tags": {"a", "b", "c"}})
    b = node_data_for_cache_key({"tags": {"c", "b", "a"}})
    assert a == b


def test_plain_dict_keys_remain_stable_under_typical_inputs() -> None:
    """No new tags for JSON-native scalars: existing cached entries must still hit."""
    a = node_data_for_cache_key({"a": 1, "b": "x", "c": True, "d": None, "e": [1, 2]})
    b = node_data_for_cache_key({"e": [1, 2], "d": None, "c": True, "b": "x", "a": 1})
    assert a == b
    # No __t__ tags appear for scalar/list/dict input.
    import json as _j

    encoded = _j.dumps(a, sort_keys=True)
    assert "__t__" not in encoded


# ---------------------------------------------------------------------------
# Atomic CAS: concurrent put() on the same key never clobbers.
# ---------------------------------------------------------------------------


def test_put_returns_true_for_winner_false_for_loser(tmp_path) -> None:
    store = StepCacheStore(tmp_path)
    key = "a" * 64
    payload_a = {
        "nodeType": "task",
        "data": {"who": "a"},
        "processResult": {"success": True, "exitCode": 0},
    }
    payload_b = {
        "nodeType": "task",
        "data": {"who": "b"},
        "processResult": {"success": True, "exitCode": 0},
    }
    assert store.put(key, payload_a) is True
    assert store.put(key, payload_b) is False
    # Reader observes the winner's payload only.
    got = store.get(key)
    assert got is not None
    assert got["data"]["who"] == "a"


def test_concurrent_put_yields_single_winner(tmp_path) -> None:
    """Many threads race to put the same key; exactly one wins, all readers see same value."""
    store = StepCacheStore(tmp_path)
    key = "c" * 64
    n = 16
    barrier = threading.Barrier(n)
    winners: list[bool] = []
    lock = threading.Lock()

    def worker(tid: int) -> None:
        payload = {
            "nodeType": "task",
            "data": {"tid": tid},
            "processResult": {"success": True, "exitCode": 0},
        }
        barrier.wait()
        won = store.put(key, payload)
        with lock:
            winners.append(won)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(n)]
    for th in threads:
        th.start()
    for th in threads:
        th.join()

    assert sum(1 for w in winners if w) == 1
    assert sum(1 for w in winners if not w) == n - 1

    # All n threads see the same payload once the dust settles.
    seen = [store.get(key) for _ in range(n)]
    first = seen[0]
    for s in seen:
        assert s == first


def test_put_is_idempotent_on_repeated_same_key(tmp_path) -> None:
    store = StepCacheStore(tmp_path)
    key = "d" * 64
    payload = {
        "nodeType": "task",
        "data": {"command": "echo"},
        "processResult": {"success": True, "exitCode": 0},
    }
    assert store.put(key, payload) is True
    assert store.put(key, payload) is False
    assert store.get(key) == payload
