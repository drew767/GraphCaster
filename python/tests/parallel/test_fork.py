# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from graph_caster.parallel.context import BranchContext
from graph_caster.parallel.fork import ForkNode, ForkStrategy


class TestForkNode:
    def test_create_branches_from_outputs(self):
        fork = ForkNode(strategy=ForkStrategy.PARALLEL)
        branches = fork.create_branches(
            output_ports=["out_a", "out_b", "out_c"],
            input_data={"value": 42},
        )
        assert len(branches) == 3
        assert branches[0].port == "out_a"
        assert branches[1].port == "out_b"
        assert branches[2].port == "out_c"

    def test_branch_inherits_context(self):
        parent_context = BranchContext(
            run_id="run-1",
            node_outputs={"Start": {"x": 1}},
            variables={"key": "value"},
        )
        fork = ForkNode(strategy=ForkStrategy.PARALLEL)
        branches = fork.create_branches(
            output_ports=["out"],
            input_data={},
            parent_context=parent_context,
        )
        assert branches[0].context.run_id == "run-1"
        assert branches[0].context.node_outputs["Start"]["x"] == 1
        branches[0].context.variables["new"] = "data"
        assert "new" not in parent_context.variables

    def test_sequential_strategy(self):
        fork = ForkNode(strategy=ForkStrategy.SEQUENTIAL)
        branches = fork.create_branches(
            output_ports=["a", "b", "c"],
            input_data={},
        )
        assert all(b.sequential for b in branches)

    def test_limited_parallel_strategy(self):
        fork = ForkNode(strategy=ForkStrategy.PARALLEL, max_parallel=2)
        assert fork.max_parallel == 2

    def test_branch_with_condition(self):
        fork = ForkNode(strategy=ForkStrategy.PARALLEL)
        branches = fork.create_branches(
            output_ports=["out_success", "out_error"],
            input_data={"status": "ok"},
            conditions={
                "out_success": "$json.status == 'ok'",
                "out_error": "$json.status != 'ok'",
            },
        )
        assert branches[0].condition == "$json.status == 'ok'"
        assert branches[1].condition == "$json.status != 'ok'"
