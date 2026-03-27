# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from graph_caster.edge_conditions import MAX_EDGE_CONDITION_CHARS, eval_edge_condition


def test_legacy_true_false_last_result() -> None:
    assert eval_edge_condition("true", {"last_result": False}) is True
    assert eval_edge_condition("false", {"last_result": True}) is False
    assert eval_edge_condition("foobar", {"last_result": 7}) is True


def test_json_eq_var_last_result() -> None:
    rule = '{"==":[{"var":"last_result"}, true]}'
    assert eval_edge_condition(rule, {"last_result": True}) is True
    assert eval_edge_condition(rule, {"last_result": False}) is False


def test_json_rejects_unknown_root_op() -> None:
    assert eval_edge_condition('{"unknown": [1, 2]}', {"last_result": True}) is False


def test_json_invalid_returns_false() -> None:
    assert eval_edge_condition("{not json", {"last_result": True}) is False
    assert eval_edge_condition("{}", {"last_result": True}) is False


def test_public_context_hides_underscore_keys_for_var() -> None:
    assert (
        eval_edge_condition(
            '{"==":[{"var":"node_outputs.t1.processResult.exitCode"}, 7]}',
            {
                "last_result": True,
                "node_outputs": {"t1": {"processResult": {"exitCode": 7}}},
            },
        )
        is True
    )
    assert (
        eval_edge_condition(
            '{"==":[{"var":"_secret"}, 1]}',
            {"last_result": True, "_secret": 1},
        )
        is False
    )


def test_legacy_before_json_object_false_positive() -> None:
    assert eval_edge_condition(" true ", {}) is True


def test_and_or_if() -> None:
    assert (
        eval_edge_condition(
            '{"and": [{"==": [1, 1]}, {"==": [2, 2]}]}',
            {},
        )
        is True
    )
    assert (
        eval_edge_condition(
            '{"or": [{"==": [1, 2]}, {"==": [3, 3]}]}',
            {},
        )
        is True
    )
    assert (
        eval_edge_condition(
            '{"if": [{"==": [1, 1]}, true, false]}',
            {},
        )
        is True
    )


def test_in_operator() -> None:
    assert eval_edge_condition('{"in":[2, [1, 2, 3]]}', {}) is True
    assert eval_edge_condition('{"in":[9, [1, 2, 3]]}', {}) is False


def test_modulo() -> None:
    assert eval_edge_condition('{"==":[{"%":[7, 3]}, 1]}', {}) is True


def test_var_default() -> None:
    rule = '{"==":[{"var":["missing", 42]}, 42]}'
    assert eval_edge_condition(rule, {}) is True


def test_condition_string_exceeds_max_length_returns_false() -> None:
    long_legacy = "x" * (MAX_EDGE_CONDITION_CHARS + 1)
    assert eval_edge_condition(long_legacy, {"last_result": True}) is False

    huge_brace = "{" + "a" * (MAX_EDGE_CONDITION_CHARS - 1) + "}"
    assert len(huge_brace) == MAX_EDGE_CONDITION_CHARS + 1
    assert eval_edge_condition(huge_brace, {}) is False

    at_limit = "y" * MAX_EDGE_CONDITION_CHARS
    assert eval_edge_condition(at_limit, {"last_result": True}) is True
