# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from graph_caster.node_output_cache import (
    StepCacheStore,
    compute_step_cache_key,
    node_data_for_cache_key,
    step_cache_root,
    upstream_outputs_fingerprint,
    upstream_step_cache_fingerprint,
)


def test_compute_step_cache_key_stable() -> None:
    k1 = compute_step_cache_key(
        graph_rev="aa",
        graph_id="g",
        node_id="n1",
        node_data={"command": "echo", "stepCache": True},
        upstream_outputs={"s1": {"nodeType": "start", "data": {}}},
    )
    k2 = compute_step_cache_key(
        graph_rev="aa",
        graph_id="g",
        node_id="n1",
        node_data={"command": "echo"},
        upstream_outputs={"s1": {"nodeType": "start", "data": {}}},
    )
    assert k1 == k2


def test_compute_step_cache_key_workspace_secrets_fp_changes_key() -> None:
    base = {
        "graph_rev": "r",
        "graph_id": "g",
        "node_id": "n",
        "node_data": {"command": "x", "envKeys": ["K"]},
        "upstream_outputs": {"s": {"nodeType": "start", "data": {}}},
    }
    a = compute_step_cache_key(**base, workspace_secrets_file_fp="aaa")
    b = compute_step_cache_key(**base, workspace_secrets_file_fp="bbb")
    c = compute_step_cache_key(**base, workspace_secrets_file_fp=None)
    assert a != b
    assert a != c


def test_node_data_for_cache_key_drops_step_cache_flag() -> None:
    a = node_data_for_cache_key({"command": "x", "stepCache": True})
    b = node_data_for_cache_key({"command": "x"})
    assert a == b


def test_step_cache_store_roundtrip(tmp_path) -> None:
    root = tmp_path / "cache"
    store = StepCacheStore(root)
    key = "a" * 64
    payload = {"nodeType": "task", "data": {"command": "echo"}, "processResult": {"success": True, "exitCode": 0}}
    store.put(key, payload)
    assert store.get(key) == payload
    p = root / key[:2] / key[2:4] / f"{key}.json"
    assert p.is_file()


def test_step_cache_root_under_runs(tmp_path) -> None:
    base = tmp_path / "ws"
    r = step_cache_root(base, "my-graph-id-uuid")
    assert r.parts[-3:] == ("my-graph-id-uuid", "step-cache", "v1")
    assert "runs" in r.parts


def _valid_task_entry(*, success: bool = True) -> dict:
    return {
        "nodeType": "task",
        "data": {"command": "echo"},
        "processResult": {"success": success, "exitCode": 0 if success else 1},
    }


def test_different_keys_different_files(tmp_path) -> None:
    root = tmp_path / "c"
    store = StepCacheStore(root)
    store.put("b" * 64, _valid_task_entry(success=True))
    store.put("c" * 64, _valid_task_entry(success=False))
    assert store.get("b" * 64) == _valid_task_entry(success=True)
    assert store.get("c" * 64) == _valid_task_entry(success=False)


def test_step_cache_get_rejects_malformed_entry(tmp_path) -> None:
    root = tmp_path / "c"
    store = StepCacheStore(root)
    key = "f" * 64
    store.put(key, {"a": 1})
    assert store.get(key) is None


def test_upstream_fingerprint_stable_under_key_order() -> None:
    up = {"z": {"x": 1}, "a": {"y": 2}}
    assert upstream_outputs_fingerprint(up) == upstream_outputs_fingerprint(up)


def test_upstream_step_cache_fingerprint_nested_graph_ref_pairs() -> None:
    up = {"pref": {"nodeType": "graph_ref", "data": {"targetGraphId": "cccccccc-cccc-4ccc-8ccc-cccccccccccc"}}}
    legacy = upstream_outputs_fingerprint(up)
    assert upstream_step_cache_fingerprint(up, graph_ref_revisions=()) == legacy
    with_rev = upstream_step_cache_fingerprint(
        up,
        graph_ref_revisions=(("pref", "aa" * 32),),
    )
    assert with_rev != legacy
    other_rev = upstream_step_cache_fingerprint(
        up,
        graph_ref_revisions=(("pref", "bb" * 32),),
    )
    assert other_rev != with_rev


def test_compute_key_uses_upstream_fingerprint_not_full_blob() -> None:
    k = compute_step_cache_key(
        graph_rev="r",
        graph_id="g",
        node_id="n",
        node_data={"command": "x"},
        upstream_outputs={"s": {"nodeType": "start", "data": {}}},
    )
    huge = {"s": {"nodeType": "start", "data": {}, "extra": "x" * 50_000}}
    k_huge = compute_step_cache_key(
        graph_rev="r",
        graph_id="g",
        node_id="n",
        node_data={"command": "x"},
        upstream_outputs=huge,
    )
    assert k != k_huge
    assert len(k) == 64 and len(k_huge) == 64
