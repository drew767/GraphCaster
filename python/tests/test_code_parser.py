# Copyright GraphCaster. All Rights Reserved.

"""Tests for sandbox.code_parser: AST-based input/output inference."""

from __future__ import annotations

import pytest

from graph_caster.sandbox.code_parser import infer_inputs_from_code, infer_outputs_from_code


class TestInferInputs:
    def test_subscript_args(self) -> None:
        code = 'result = args["x"] + args["y"]'
        inputs = infer_inputs_from_code(code)
        names = [i.name for i in inputs]
        assert "x" in names
        assert "y" in names

    def test_attribute_args(self) -> None:
        code = "result = args.width * args.height"
        inputs = infer_inputs_from_code(code)
        names = [i.name for i in inputs]
        assert "width" in names
        assert "height" in names

    def test_mixed_access(self) -> None:
        code = 'total = args["price"] * args.qty'
        inputs = infer_inputs_from_code(code)
        names = [i.name for i in inputs]
        assert "price" in names
        assert "qty" in names

    def test_no_args_no_inputs(self) -> None:
        code = "result = 1 + 2"
        inputs = infer_inputs_from_code(code)
        assert inputs == []

    def test_deduplicated(self) -> None:
        code = 'a = args["x"]\nb = args["x"]'
        inputs = infer_inputs_from_code(code)
        names = [i.name for i in inputs]
        assert names.count("x") == 1

    def test_default_is_none(self) -> None:
        code = 'result = args["n"]'
        inputs = infer_inputs_from_code(code)
        assert inputs[0].default is None

    def test_syntax_error_returns_empty(self) -> None:
        inputs = infer_inputs_from_code("def foo(:\n    pass")
        assert inputs == []


class TestInferOutputs:
    def test_dict_literal_keys(self) -> None:
        code = "s = a + b\nd = a - b\nresult = {'sum': s, 'diff': d}"
        outputs = infer_outputs_from_code(code)
        names = [o.name for o in outputs]
        assert names == ["sum", "diff"]

    def test_fallback_single_result_output(self) -> None:
        code = "result = some_function()"
        outputs = infer_outputs_from_code(code)
        assert len(outputs) == 1
        assert outputs[0].name == "result"
        assert outputs[0].field_type == "json"

    def test_no_result_assignment_fallback(self) -> None:
        code = "x = 1"
        outputs = infer_outputs_from_code(code)
        assert len(outputs) == 1
        assert outputs[0].name == "result"

    def test_syntax_error_fallback(self) -> None:
        outputs = infer_outputs_from_code("def bad(:\n    ...")
        assert len(outputs) == 1
        assert outputs[0].name == "result"

    def test_dict_with_non_string_key_fallback(self) -> None:
        code = "result = {1: 'a', 2: 'b'}"
        outputs = infer_outputs_from_code(code)
        assert len(outputs) == 1
        assert outputs[0].name == "result"

    def test_empty_dict_fallback(self) -> None:
        code = "result = {}"
        outputs = infer_outputs_from_code(code)
        assert len(outputs) == 1
        assert outputs[0].name == "result"
