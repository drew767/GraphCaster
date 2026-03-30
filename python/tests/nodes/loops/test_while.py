# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import pytest

from graph_caster.nodes.loops.while_loop import WhileConfig, WhileNode


class TestWhileNode:
    def test_loop_until_condition_false(self):
        node = WhileNode(
            config=WhileConfig(
                condition="$json.count < 3",
                max_iterations=100,
            )
        )
        state = {"count": 0}
        iterations = []

        def update_state():
            state["count"] += 1
            return state.copy()

        for ctx in node.iterate(state, update_state):
            iterations.append(ctx)
        assert len(iterations) == 3

    def test_max_iterations_limit(self):
        node = WhileNode(
            config=WhileConfig(
                condition="True",
                max_iterations=5,
            )
        )
        state = {}
        iterations = list(node.iterate(state, lambda: state))
        assert len(iterations) == 5

    def test_context_includes_iteration_count(self):
        node = WhileNode(
            config=WhileConfig(
                condition="$iteration < 3",
                max_iterations=100,
            )
        )
        state = {"count": 0}

        def bump():
            state["count"] = state["count"] + 1
            return state.copy()

        contexts = list(node.iterate(state, bump))
        assert contexts[0].iteration == 0
        assert contexts[1].iteration == 1
        assert contexts[2].iteration == 2

    def test_do_while_mode(self):
        node = WhileNode(
            config=WhileConfig(
                condition="False",
                do_while=True,
                max_iterations=100,
            )
        )
        state = {}
        iterations = list(node.iterate(state, lambda: state))
        assert len(iterations) == 1

    def test_break_on_error(self):
        node = WhileNode(
            config=WhileConfig(
                condition="True",
                max_iterations=100,
                break_on_error=True,
            )
        )
        state = {"count": 0}

        def update_with_error():
            state["count"] += 1
            if state["count"] >= 3:
                raise ValueError("Simulated error")
            return state.copy()

        iterations = []
        with pytest.raises(ValueError):
            for ctx in node.iterate(state, update_with_error):
                iterations.append(ctx)
        assert len(iterations) == 3
