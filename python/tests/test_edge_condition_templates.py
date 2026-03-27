# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from graph_caster.edge_conditions import (
    MAX_EDGE_CONDITION_CHARS,
    eval_edge_condition,
    extract_template_paths,
)


def test_template_condition_exit_code_zero() -> None:
    ctx = {
        "last_result": None,
        "node_outputs": {
            "t1": {"processResult": {"exitCode": 0}},
        },
    }
    assert (
        eval_edge_condition(
            "{{node_outputs.t1.processResult.exitCode}} == 0",
            ctx,
        )
        is True
    )


def test_template_condition_exit_code_nonzero() -> None:
    ctx = {
        "last_result": None,
        "node_outputs": {
            "t1": {"processResult": {"exitCode": 1}},
        },
    }
    assert (
        eval_edge_condition(
            "{{node_outputs.t1.processResult.exitCode}} == 0",
            ctx,
        )
        is False
    )


def test_template_truthy_only() -> None:
    ctx = {
        "last_result": None,
        "node_outputs": {"a": {"x": 1}},
    }
    assert eval_edge_condition("{{node_outputs.a.x}}", ctx) is True
    assert eval_edge_condition("{{node_outputs.missing}}", ctx) is False


def test_template_not_equal() -> None:
    ctx = {"node_outputs": {"t1": {"processResult": {"exitCode": 2}}}}
    assert (
        eval_edge_condition(
            "{{node_outputs.t1.processResult.exitCode}} != 0",
            ctx,
        )
        is True
    )


def test_template_missing_path_comparison_false() -> None:
    ctx: dict = {"node_outputs": {}}
    assert (
        eval_edge_condition(
            "{{node_outputs.t1.processResult.exitCode}} == 0",
            ctx,
        )
        is False
    )


def test_template_unclosed_returns_false() -> None:
    assert eval_edge_condition("{{node_outputs.t1", {"last_result": True}) is False


def test_template_too_many_placeholders() -> None:
    parts = [f"{{{{node_outputs.n{i}}}}} == 0" for i in range(33)]
    s = " and ".join(parts)
    assert eval_edge_condition(s, {"node_outputs": {}}) is False


def test_extract_template_paths() -> None:
    assert extract_template_paths("{{node_outputs.t1.processResult.exitCode}} == 0") == [
        "node_outputs.t1.processResult.exitCode",
    ]
    assert extract_template_paths("{{ $json.processResult.exitCode }} == 0") == [
        "$json.processResult.exitCode",
    ]
    assert extract_template_paths("true") == []


def test_dollar_json_truthy_process_result() -> None:
    ctx = {
        "last_result": {"processResult": {"success": True, "exitCode": 0}},
        "node_outputs": {},
    }
    assert eval_edge_condition("{{ $json.processResult.success }}", ctx) is True
    assert eval_edge_condition("{{$json.processResult.exitCode}} == 0", ctx) is True


def test_dollar_json_wraps_non_dict_last_result() -> None:
    ctx = {"last_result": 42, "node_outputs": {}}
    assert eval_edge_condition("{{ $json.value }} == 42", ctx) is True


def test_dollar_json_bare_template_truthiness() -> None:
    assert (
        eval_edge_condition("{{ $json }}", {"last_result": {"x": 1}, "node_outputs": {}}) is True
    )
    assert eval_edge_condition("{{$json}}", {"last_result": {}, "node_outputs": {}}) is False


def test_json_logic_still_works_before_template() -> None:
    rule = '{"==":[{"var":"last_result"}, true]}'
    assert eval_edge_condition(rule, {"last_result": True}) is True


def test_legacy_last_result_unchanged() -> None:
    assert eval_edge_condition("foobar", {"last_result": 7}) is True


def test_template_string_numeric_coercion_eq() -> None:
    ctx = {"node_outputs": {"t1": {"processResult": {"exitCode": "0"}}}}
    assert (
        eval_edge_condition(
            "{{node_outputs.t1.processResult.exitCode}} == 0",
            ctx,
        )
        is True
    )


def test_template_gt_lt() -> None:
    ctx = {"node_outputs": {"a": {"x": 5}}}
    assert eval_edge_condition("{{node_outputs.a.x}} > 3", ctx) is True
    assert eval_edge_condition("{{node_outputs.a.x}} < 10", ctx) is True


def test_template_quoted_string_literal() -> None:
    ctx = {"node_outputs": {"a": {"status": "ok"}}}
    assert (
        eval_edge_condition(
            "{{node_outputs.a.status}} == \"ok\"",
            ctx,
        )
        is True
    )


def test_template_prefix_before_mustache_is_false() -> None:
    ctx = {"node_outputs": {"a": {"x": 1}}}
    assert (
        eval_edge_condition(
            "prefix {{node_outputs.a.x}} == 1",
            ctx,
        )
        is False
    )


def test_template_non_ascii_path_segment_no_placeholder() -> None:
    assert eval_edge_condition("{{café.x}} == 1", {"node_outputs": {}}) is False
    assert extract_template_paths("{{café.x}} == 1") == []


def test_template_multiline_tail_not_matched_as_literal() -> None:
    s = "{{node_outputs.a.x}} == 1\nand more"
    assert eval_edge_condition(s, {"node_outputs": {"a": {"x": 1}}}) is False


def test_extract_template_paths_respects_max_length() -> None:
    pad = "x" * MAX_EDGE_CONDITION_CHARS
    long_s = f"{{{{a}}}}" + pad
    assert len(long_s.strip()) > MAX_EDGE_CONDITION_CHARS
    assert extract_template_paths(long_s) == []


def test_template_dollar_node_bracket_truthy_and_cmp() -> None:
    uid = "550e8400-e29b-41d4-a716-446655440000"
    ctx = {
        "last_result": None,
        "node_outputs": {
            uid: {"processResult": {"success": True, "exitCode": 0}},
            "t1": {"processResult": {"exitCode": 2}},
        },
    }
    assert (
        eval_edge_condition(
            f'{{{{ $node["{uid}"].processResult.success }}}}',
            ctx,
        )
        is True
    )
    assert (
        eval_edge_condition(
            f'{{{{ $node[\'{uid}\'].processResult.exitCode }}}} == 0',
            ctx,
        )
        is True
    )
    assert eval_edge_condition("{{ $node.t1.processResult.exitCode }} == 2", ctx) is True


def test_template_dollar_node_missing_id_false() -> None:
    ctx = {"last_result": True, "node_outputs": {}}
    assert eval_edge_condition('{{ $node["missing"].x }}', ctx) is False


def test_extract_template_paths_dollar_node() -> None:
    assert extract_template_paths('{{ $node["a-b"].x }} == 1') == ['$node["a-b"].x']
    assert extract_template_paths("{{ $node.t1.y }}") == ["$node.t1.y"]
