# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from graph_caster.parallel.merge import BranchResult, MergeNode, MergeStrategy


class TestMergeNode:
    def test_merge_all_results(self):
        merge = MergeNode(strategy=MergeStrategy.COLLECT_ALL)
        results = [
            BranchResult(branch_id="a", port="out_a", output={"x": 1}, ok=True),
            BranchResult(branch_id="b", port="out_b", output={"y": 2}, ok=True),
            BranchResult(branch_id="c", port="out_c", output={"z": 3}, ok=True),
        ]
        merged = merge.merge(results)
        assert merged.ok is True
        assert merged.output["results"]["out_a"] == {"x": 1}
        assert merged.output["results"]["out_b"] == {"y": 2}
        assert merged.output["results"]["out_c"] == {"z": 3}

    def test_merge_first_success(self):
        merge = MergeNode(strategy=MergeStrategy.FIRST_SUCCESS)
        results = [
            BranchResult(branch_id="a", port="out_a", output=None, ok=False, error="fail"),
            BranchResult(branch_id="b", port="out_b", output={"y": 2}, ok=True),
            BranchResult(branch_id="c", port="out_c", output={"z": 3}, ok=True),
        ]
        merged = merge.merge(results)
        assert merged.ok is True
        assert merged.output == {"y": 2}

    def test_merge_all_must_succeed(self):
        merge = MergeNode(strategy=MergeStrategy.ALL_MUST_SUCCEED)
        results = [
            BranchResult(branch_id="a", port="out_a", output={"x": 1}, ok=True),
            BranchResult(branch_id="b", port="out_b", output=None, ok=False, error="fail"),
        ]
        merged = merge.merge(results)
        assert merged.ok is False
        assert merged.error is not None
        assert "fail" in (merged.error or "")

    def test_merge_concat_arrays(self):
        merge = MergeNode(strategy=MergeStrategy.CONCAT_ARRAYS)
        results = [
            BranchResult(branch_id="a", port="out", output={"items": [1, 2]}, ok=True),
            BranchResult(branch_id="b", port="out", output={"items": [3, 4]}, ok=True),
        ]
        merged = merge.merge(results, array_key="items")
        assert merged.ok is True
        assert merged.output["items"] == [1, 2, 3, 4]

    def test_merge_with_timeout(self):
        merge = MergeNode(strategy=MergeStrategy.COLLECT_ALL, wait_timeout=1.0)
        results = [
            BranchResult(branch_id="a", port="out_a", output={"x": 1}, ok=True),
        ]
        merged = merge.merge(results, expected_count=2)
        assert merged.ok is False
        assert merged.error is not None
        assert "timeout" in (merged.error or "").lower()

    def test_race_strategy(self):
        merge = MergeNode(strategy=MergeStrategy.RACE)
        results = [
            BranchResult(branch_id="b", port="out_b", output={"winner": True}, ok=True),
        ]
        merged = merge.merge(results)
        assert merged.ok is True
        assert merged.output == {"winner": True}
