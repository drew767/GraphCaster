# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from graph_caster.nodes.loops.control import LoopControlAction, LoopController
from graph_caster.nodes.loops.for_each import ForEachConfig, ForEachNode


class TestLoopControl:
    def test_break_exits_loop(self):
        controller = LoopController()
        node = ForEachNode(config=ForEachConfig(input_key="items"))
        items = [1, 2, 3, 4, 5]
        processed = []
        for ctx in node.iterate({"items": items}):
            if ctx.item == 3:
                controller.signal_break()
            if controller.should_break:
                break
            processed.append(ctx.item)
        assert processed == [1, 2]

    def test_continue_skips_iteration(self):
        controller = LoopController()
        node = ForEachNode(config=ForEachConfig(input_key="items"))
        items = [1, 2, 3, 4, 5]
        processed = []
        for ctx in node.iterate({"items": items}):
            if ctx.item == 3:
                controller.signal_continue()
            if controller.should_continue:
                controller.reset_continue()
                continue
            processed.append(ctx.item)
        assert processed == [1, 2, 4, 5]

    def test_break_with_return_value(self):
        controller = LoopController()
        controller.signal_break(return_value={"result": "early_exit"})
        assert controller.break_value == {"result": "early_exit"}

    def test_control_via_output_port(self):
        controller = LoopController()
        node_result = {
            "_control": LoopControlAction.BREAK.value,
            "data": {"reason": "found_match"},
        }
        action = controller.parse_output(node_result)
        assert action == LoopControlAction.BREAK
        assert controller.should_break is True

    def test_nested_loop_control(self):
        outer_items = ["a", "b", "c"]
        inner_items = [1, 2, 3]
        inner_controller = LoopController()
        outer_processed = []
        inner_totals = []
        for outer in outer_items:
            inner_controller.reset()
            inner_count = 0
            for inner in inner_items:
                if inner == 2 and outer == "b":
                    inner_controller.signal_break()
                if inner_controller.should_break:
                    break
                inner_count += 1
            outer_processed.append(outer)
            inner_totals.append(inner_count)
        assert outer_processed == ["a", "b", "c"]
        assert inner_totals == [3, 1, 3]
