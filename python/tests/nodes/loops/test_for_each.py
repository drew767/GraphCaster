# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import pytest

from graph_caster.nodes.loops.for_each import ForEachConfig, ForEachNode


class TestForEachNode:
    def test_iterate_over_list(self):
        node = ForEachNode(config=ForEachConfig(input_key="items"))
        items = [1, 2, 3, 4, 5]
        iterations = list(node.iterate({"items": items}))
        assert len(iterations) == 5
        assert iterations[0].item == 1
        assert iterations[0].index == 0
        assert iterations[4].item == 5
        assert iterations[4].index == 4

    def test_iterate_with_batch_size(self):
        node = ForEachNode(config=ForEachConfig(input_key="items", batch_size=2))
        items = [1, 2, 3, 4, 5]
        batches = list(node.iterate_batches({"items": items}))
        assert len(batches) == 3
        assert batches[0].items == [1, 2]
        assert batches[1].items == [3, 4]
        assert batches[2].items == [5]

    def test_emit_progress_events(self):
        node = ForEachNode(config=ForEachConfig(input_key="items"))
        items = [1, 2, 3]
        events = [node.emit_progress(ctx) for ctx in node.iterate({"items": items})]
        assert len(events) == 3
        assert events[0].current == 1
        assert events[0].total == 3
        assert events[2].current == 3

    def test_with_dict_items(self):
        node = ForEachNode(config=ForEachConfig(input_key="data", iterate_mode="entries"))
        data = {"a": 1, "b": 2, "c": 3}
        iterations = list(node.iterate({"data": data}))
        assert len(iterations) == 3
        assert iterations[0].item in (("a", 1), ("b", 2), ("c", 3))

    def test_empty_input(self):
        node = ForEachNode(config=ForEachConfig(input_key="items"))
        assert list(node.iterate({"items": []})) == []

    def test_missing_input_key(self):
        node = ForEachNode(config=ForEachConfig(input_key="items"))
        with pytest.raises(KeyError):
            list(node.iterate({"other": [1, 2, 3]}))

    def test_context_has_loop_metadata(self):
        node = ForEachNode(config=ForEachConfig(input_key="items"))
        ctx = next(node.iterate({"items": [10, 20, 30]}))
        assert ctx.item == 10
        assert ctx.index == 0
        assert ctx.is_first is True
        assert ctx.is_last is False
        assert ctx.total == 3
