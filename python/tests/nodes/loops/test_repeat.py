# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import pytest

from graph_caster.nodes.loops.repeat import RepeatConfig, RepeatNode


class TestRepeatNode:
    def test_repeat_fixed_count(self):
        node = RepeatNode(config=RepeatConfig(count=5))
        iterations = list(node.iterate({}))
        assert len(iterations) == 5
        assert iterations[0].iteration == 0
        assert iterations[4].iteration == 4

    def test_repeat_with_dynamic_count(self):
        node = RepeatNode(config=RepeatConfig(count_expression="$json.repeat_times"))
        iterations = list(node.iterate({"repeat_times": 3}))
        assert len(iterations) == 3

    def test_repeat_zero_times(self):
        node = RepeatNode(config=RepeatConfig(count=0))
        assert list(node.iterate({})) == []

    def test_context_has_loop_info(self):
        node = RepeatNode(config=RepeatConfig(count=3))
        ctx = next(node.iterate({}))
        assert ctx.iteration == 0
        assert ctx.total == 3
        assert ctx.is_first is True
        assert ctx.remaining == 2

    def test_progress_events(self):
        node = RepeatNode(config=RepeatConfig(count=3))
        node.set_node_id("repeat-1")
        contexts = list(node.iterate({}))
        progress = node.emit_progress(contexts[1])
        assert progress.current == 2
        assert progress.total == 3
        assert progress.percent == pytest.approx(66.7, rel=0.1)
