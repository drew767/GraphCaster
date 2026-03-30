# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import time

from graph_caster.parallel import (
    BranchContext,
    BranchResult,
    ForkNode,
    ForkStrategy,
    MergeNode,
    MergeStrategy,
    ParallelExecutor,
    ResourceLimits,
)


class TestParallelIntegration:
    def test_fork_execute_merge(self):
        executor = ParallelExecutor(max_workers=4)
        fork = ForkNode(strategy=ForkStrategy.PARALLEL)
        merge = MergeNode(strategy=MergeStrategy.COLLECT_ALL)
        parent_ctx = BranchContext(
            run_id="run-1",
            node_outputs={"Start": {"value": 10}},
        )
        branches = fork.create_branches(
            output_ports=["double", "triple", "square"],
            input_data={"value": 10},
            parent_context=parent_ctx,
        )

        def execute_branch(spec):
            value = parent_ctx.node_outputs["Start"]["value"]
            if spec.port == "double":
                result = value * 2
            elif spec.port == "triple":
                result = value * 3
            else:
                result = value**2
            time.sleep(0.05)
            return BranchResult(
                branch_id=spec.branch_id,
                port=spec.port,
                output={"result": result},
                ok=True,
            )

        futures = [executor.submit(execute_branch, b) for b in branches]
        results = [f.result() for f in futures]
        merged = merge.merge(results)
        assert merged.ok is True
        assert merged.output["results"]["double"] == {"result": 20}
        assert merged.output["results"]["triple"] == {"result": 30}
        assert merged.output["results"]["square"] == {"result": 100}
        executor.shutdown()

    def test_with_resource_limits(self):
        limits = ResourceLimits(
            max_parallel_graphs=2,
            max_parallel_nodes_per_graph=2,
        )
        executor = ParallelExecutor(max_workers=8)
        execution_times: list[tuple[str, str, float]] = []

        def execute_node(graph_id: str, node_id: str):
            graph_token, total_token = limits.acquire_node(graph_id, node_id)
            try:
                start = time.monotonic()
                time.sleep(0.1)
                execution_times.append((graph_id, node_id, start))
                return {"graph": graph_id, "node": node_id}
            finally:
                limits.release_node(graph_id, graph_token, total_token)

        futures = [executor.submit(execute_node, "g1", f"n{i}") for i in range(4)]
        [f.result() for f in futures]
        starts = sorted(t[2] for t in execution_times)
        assert starts[2] - starts[1] > 0.05
        executor.shutdown()

    def test_error_handling_in_parallel(self):
        executor = ParallelExecutor(max_workers=4)
        merge = MergeNode(strategy=MergeStrategy.COLLECT_ALL)

        def branch_a():
            return BranchResult("a", "out_a", {"x": 1}, True)

        def branch_b():
            raise ValueError("Branch B failed")

        def branch_c():
            return BranchResult("c", "out_c", {"z": 3}, True)

        def safe_execute(fn):
            try:
                return fn()
            except Exception as e:
                return BranchResult("b", "out_b", None, False, str(e))

        futures = [
            executor.submit(safe_execute, branch_a),
            executor.submit(safe_execute, branch_b),
            executor.submit(safe_execute, branch_c),
        ]
        results = [f.result() for f in futures]
        merged = merge.merge(results)
        assert merged.ok is False
        assert merged.output["success_count"] == 2
        assert merged.output["failure_count"] == 1
        executor.shutdown()
