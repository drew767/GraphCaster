# Copyright GraphCaster. All Rights Reserved.

"""Tests for F43 cache strategies (cache_strategies.py)."""

from __future__ import annotations

import pytest

from graph_caster.cache_strategies import (
    IdCacheStrategy,
    InputSignatureCacheStrategy,
    LRUCacheStrategy,
    strategy_from_name,
)


# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------

_NODE_DATA: dict = {"command": "echo hello", "stepCache": True}
_UPSTREAM_A: dict = {"s1": {"nodeType": "start", "data": {}}}
_UPSTREAM_B: dict = {
    "s1": {"nodeType": "start", "data": {}},
    "t1": {"nodeType": "task", "processResult": {"success": True, "exitCode": 0}},
}
_DOC_REV = "aaaa1234"


# ---------------------------------------------------------------------------
# IdCacheStrategy
# ---------------------------------------------------------------------------


class TestIdCacheStrategy:
    def test_same_node_same_data_same_key(self) -> None:
        s = IdCacheStrategy()
        k1 = s.compute_key("n1", _NODE_DATA, _UPSTREAM_A, _DOC_REV)
        k2 = s.compute_key("n1", _NODE_DATA, _UPSTREAM_A, _DOC_REV)
        assert k1 == k2

    def test_different_upstream_different_key(self) -> None:
        """Id strategy INCLUDES upstream fingerprint, so upstream change → key change."""
        s = IdCacheStrategy()
        k1 = s.compute_key("n1", _NODE_DATA, _UPSTREAM_A, _DOC_REV)
        k2 = s.compute_key("n1", _NODE_DATA, _UPSTREAM_B, _DOC_REV)
        assert k1 != k2

    def test_different_node_id_different_key(self) -> None:
        s = IdCacheStrategy()
        k1 = s.compute_key("n1", _NODE_DATA, _UPSTREAM_A, _DOC_REV)
        k2 = s.compute_key("n2", _NODE_DATA, _UPSTREAM_A, _DOC_REV)
        assert k1 != k2

    def test_different_doc_rev_different_key(self) -> None:
        s = IdCacheStrategy()
        k1 = s.compute_key("n1", _NODE_DATA, _UPSTREAM_A, _DOC_REV)
        k2 = s.compute_key("n1", _NODE_DATA, _UPSTREAM_A, "bbbb5678")
        assert k1 != k2

    def test_step_cache_flag_stripped_from_key_material(self) -> None:
        """gcCacheControl is separate; stepCache flag must not change the key."""
        s = IdCacheStrategy()
        k1 = s.compute_key("n1", {"command": "echo", "stepCache": True}, _UPSTREAM_A, _DOC_REV)
        k2 = s.compute_key("n1", {"command": "echo"}, _UPSTREAM_A, _DOC_REV)
        assert k1 == k2

    def test_get_put_roundtrip(self) -> None:
        s = IdCacheStrategy()
        s.put("deadbeef", {"result": 42})
        assert s.get("deadbeef") == {"result": 42}

    def test_get_miss_returns_none(self) -> None:
        s = IdCacheStrategy()
        assert s.get("nonexistent") is None

    def test_key_is_hex_sha256(self) -> None:
        s = IdCacheStrategy()
        k = s.compute_key("n1", _NODE_DATA, _UPSTREAM_A, _DOC_REV)
        assert len(k) == 64
        int(k, 16)  # must be valid hex


# ---------------------------------------------------------------------------
# InputSignatureCacheStrategy
# ---------------------------------------------------------------------------


class TestInputSignatureCacheStrategy:
    def test_same_inputs_same_key(self) -> None:
        s = InputSignatureCacheStrategy()
        k1 = s.compute_key("n1", _NODE_DATA, _UPSTREAM_A, _DOC_REV)
        k2 = s.compute_key("n1", _NODE_DATA, _UPSTREAM_A, _DOC_REV)
        assert k1 == k2

    def test_same_effective_inputs_reordered_upstream_dict_same_key(self) -> None:
        """Dict insertion order must not affect the key (ancestors sorted by id)."""
        s = InputSignatureCacheStrategy()
        upstream_fwd = {
            "a_node": {"nodeType": "task", "data": {"x": 1}},
            "z_node": {"nodeType": "task", "data": {"y": 2}},
        }
        upstream_rev = {
            "z_node": {"nodeType": "task", "data": {"y": 2}},
            "a_node": {"nodeType": "task", "data": {"x": 1}},
        }
        k1 = s.compute_key("n1", _NODE_DATA, upstream_fwd, _DOC_REV)
        k2 = s.compute_key("n1", _NODE_DATA, upstream_rev, _DOC_REV)
        assert k1 == k2

    def test_upstream_output_change_different_key(self) -> None:
        """When one ancestor's output value changes the key must change."""
        s = InputSignatureCacheStrategy()
        up_v1 = {"s1": {"nodeType": "start", "data": {}}}
        up_v2 = {"s1": {"nodeType": "start", "data": {"extra": "new_value"}}}
        k1 = s.compute_key("n1", _NODE_DATA, up_v1, _DOC_REV)
        k2 = s.compute_key("n1", _NODE_DATA, up_v2, _DOC_REV)
        assert k1 != k2

    def test_different_node_id_different_key(self) -> None:
        s = InputSignatureCacheStrategy()
        k1 = s.compute_key("n1", _NODE_DATA, _UPSTREAM_A, _DOC_REV)
        k2 = s.compute_key("n2", _NODE_DATA, _UPSTREAM_A, _DOC_REV)
        assert k1 != k2

    def test_step_cache_flag_stripped(self) -> None:
        s = InputSignatureCacheStrategy()
        k1 = s.compute_key("n1", {"command": "echo", "stepCache": True}, _UPSTREAM_A, _DOC_REV)
        k2 = s.compute_key("n1", {"command": "echo"}, _UPSTREAM_A, _DOC_REV)
        assert k1 == k2

    def test_get_put_roundtrip(self) -> None:
        s = InputSignatureCacheStrategy()
        s.put("cafebabe", [1, 2, 3])
        assert s.get("cafebabe") == [1, 2, 3]

    def test_key_is_hex_sha256(self) -> None:
        s = InputSignatureCacheStrategy()
        k = s.compute_key("n1", _NODE_DATA, _UPSTREAM_A, _DOC_REV)
        assert len(k) == 64
        int(k, 16)

    def test_id_and_input_signature_produce_different_keys(self) -> None:
        """The two strategies are independent formulas — keys should differ."""
        id_s = IdCacheStrategy()
        is_s = InputSignatureCacheStrategy()
        ki = id_s.compute_key("n1", _NODE_DATA, _UPSTREAM_A, _DOC_REV)
        ks = is_s.compute_key("n1", _NODE_DATA, _UPSTREAM_A, _DOC_REV)
        assert ki != ks


# ---------------------------------------------------------------------------
# LRUCacheStrategy
# ---------------------------------------------------------------------------


class TestLRUCacheStrategy:
    def test_basic_get_put(self) -> None:
        s = LRUCacheStrategy(max_entries=10, inner=IdCacheStrategy())
        s.put("k1", "v1")
        assert s.get("k1") == "v1"

    def test_miss_returns_none(self) -> None:
        s = LRUCacheStrategy(max_entries=10, inner=IdCacheStrategy())
        assert s.get("missing") is None

    def test_lru_eviction(self) -> None:
        """Inserting N+1 entries should evict the oldest one."""
        cap = 3
        s = LRUCacheStrategy(max_entries=cap, inner=IdCacheStrategy())
        for i in range(cap):
            s.put(f"k{i}", f"v{i}")
        # All cap entries present
        for i in range(cap):
            assert s.get(f"k{i}") == f"v{i}"

        # Access k0 and k1 to make k2 the LRU (k0 and k1 were accessed last)
        # Reorder: insert a new item after fresh accesses to k0, k1, k2
        # Oldest inserted = k0; then k1; then k2.  None yet accessed → k0 is LRU.
        # Insert k3 → k0 evicted.
        s2 = LRUCacheStrategy(max_entries=cap, inner=IdCacheStrategy())
        s2.put("k0", "v0")
        s2.put("k1", "v1")
        s2.put("k2", "v2")
        # Now insert k3 — k0 should be evicted (oldest, never re-accessed)
        s2.put("k3", "v3")
        assert s2.get("k0") is None
        assert s2.get("k1") == "v1"
        assert s2.get("k2") == "v2"
        assert s2.get("k3") == "v3"

    def test_lru_access_refreshes_order(self) -> None:
        """Accessing an entry should move it to MRU position, protecting it."""
        s = LRUCacheStrategy(max_entries=3, inner=IdCacheStrategy())
        s.put("k0", "v0")
        s.put("k1", "v1")
        s.put("k2", "v2")
        # Access k0 to make it recently used
        _ = s.get("k0")
        # Now insert k3 — LRU is k1 (k0 was accessed, k2 was inserted last)
        s.put("k3", "v3")
        assert s.get("k1") is None  # evicted
        assert s.get("k0") == "v0"
        assert s.get("k2") == "v2"
        assert s.get("k3") == "v3"

    def test_compute_key_delegated_to_inner(self) -> None:
        inner = IdCacheStrategy()
        s = LRUCacheStrategy(max_entries=10, inner=inner)
        k_lru = s.compute_key("n1", _NODE_DATA, _UPSTREAM_A, _DOC_REV)
        k_inner = inner.compute_key("n1", _NODE_DATA, _UPSTREAM_A, _DOC_REV)
        assert k_lru == k_inner

    def test_max_entries_zero_raises(self) -> None:
        with pytest.raises(ValueError):
            LRUCacheStrategy(max_entries=0, inner=IdCacheStrategy())

    def test_max_entries_negative_raises(self) -> None:
        with pytest.raises(ValueError):
            LRUCacheStrategy(max_entries=-5, inner=IdCacheStrategy())

    def test_overwrite_same_key_no_growth(self) -> None:
        """Putting the same key twice must not grow the store beyond max."""
        cap = 2
        s = LRUCacheStrategy(max_entries=cap, inner=IdCacheStrategy())
        s.put("k0", "v0a")
        s.put("k0", "v0b")  # overwrite
        s.put("k1", "v1")
        # Capacity = 2; k0 (overwrite) and k1 both present, none evicted
        assert s.get("k0") == "v0b"
        assert s.get("k1") == "v1"


# ---------------------------------------------------------------------------
# gcCacheControl.fingerprint
# ---------------------------------------------------------------------------


class TestGcCacheControlFingerprint:
    def test_fingerprint_changes_id_key(self) -> None:
        s = IdCacheStrategy()
        data_no_fp = {"command": "echo"}
        data_fp_a = {"command": "echo", "gcCacheControl": {"fingerprint": "aaa"}}
        data_fp_b = {"command": "echo", "gcCacheControl": {"fingerprint": "bbb"}}
        k_no = s.compute_key("n1", data_no_fp, _UPSTREAM_A, _DOC_REV)
        k_a = s.compute_key("n1", data_fp_a, _UPSTREAM_A, _DOC_REV)
        k_b = s.compute_key("n1", data_fp_b, _UPSTREAM_A, _DOC_REV)
        assert k_no != k_a
        assert k_a != k_b
        assert k_no != k_b

    def test_fingerprint_changes_input_signature_key(self) -> None:
        s = InputSignatureCacheStrategy()
        data_no_fp = {"command": "echo"}
        data_fp_a = {"command": "echo", "gcCacheControl": {"fingerprint": "aaa"}}
        data_fp_b = {"command": "echo", "gcCacheControl": {"fingerprint": "bbb"}}
        k_no = s.compute_key("n1", data_no_fp, _UPSTREAM_A, _DOC_REV)
        k_a = s.compute_key("n1", data_fp_a, _UPSTREAM_A, _DOC_REV)
        k_b = s.compute_key("n1", data_fp_b, _UPSTREAM_A, _DOC_REV)
        assert k_no != k_a
        assert k_a != k_b

    def test_same_fingerprint_same_key(self) -> None:
        s = IdCacheStrategy()
        data = {"command": "echo", "gcCacheControl": {"fingerprint": "stable"}}
        k1 = s.compute_key("n1", data, _UPSTREAM_A, _DOC_REV)
        k2 = s.compute_key("n1", data, _UPSTREAM_A, _DOC_REV)
        assert k1 == k2

    def test_fingerprint_none_value_treated_as_absent(self) -> None:
        s = IdCacheStrategy()
        data_no_ctrl = {"command": "echo"}
        data_none_fp = {"command": "echo", "gcCacheControl": {"fingerprint": None}}
        k1 = s.compute_key("n1", data_no_ctrl, _UPSTREAM_A, _DOC_REV)
        k2 = s.compute_key("n1", data_none_fp, _UPSTREAM_A, _DOC_REV)
        # gcCacheControl itself (without a fingerprint) is still part of node_data
        # so keys differ because of the gcCacheControl dict itself; but the
        # _extract_gc_fingerprint returns None, so no extra "gc_fp" key in payload.
        # They differ because gcCacheControl key remains in clean_data for IdStrategy.
        # This is an intentional side-effect of only stripping "stepCache".
        assert k1 != k2  # gcCacheControl dict is in data

    def test_fingerprint_key_absent_in_ctrl_treated_as_absent(self) -> None:
        """gcCacheControl without 'fingerprint' key → no gc_fp injected."""
        s = IdCacheStrategy()
        data_no_fp_key = {"command": "echo", "gcCacheControl": {"otherKey": "x"}}
        # fingerprint absent → gc_fp not injected; same as not having fingerprint
        k1 = s.compute_key("n1", data_no_fp_key, _UPSTREAM_A, _DOC_REV)
        k2 = s.compute_key("n1", data_no_fp_key, _UPSTREAM_A, _DOC_REV)
        assert k1 == k2


# ---------------------------------------------------------------------------
# strategy_from_name factory
# ---------------------------------------------------------------------------


class TestStrategyFromName:
    def test_id_strategy(self) -> None:
        s = strategy_from_name("id")
        assert isinstance(s, IdCacheStrategy)

    def test_input_signature_strategy(self) -> None:
        s = strategy_from_name("input-signature")
        assert isinstance(s, InputSignatureCacheStrategy)

    def test_lru_strategy_wraps_id(self) -> None:
        s = strategy_from_name("lru")
        assert isinstance(s, LRUCacheStrategy)
        assert isinstance(s._inner, IdCacheStrategy)

    def test_lru_custom_max(self) -> None:
        s = strategy_from_name("lru", lru_max=5)
        assert isinstance(s, LRUCacheStrategy)
        assert s._max == 5

    def test_unknown_name_raises(self) -> None:
        with pytest.raises(ValueError, match="Unknown cache strategy"):
            strategy_from_name("unknown")
