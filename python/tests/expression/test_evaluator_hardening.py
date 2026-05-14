# Copyright GraphCaster. All Rights Reserved.

"""Hardening tests for known sandbox-escape vectors and dunder access."""

from __future__ import annotations

import logging

import pytest

from graph_caster.expression import ExpressionEvaluator
from graph_caster.expression.errors import (
    ExpressionTimeoutError,
    ForbiddenOperationError,
)


@pytest.fixture
def evaluator() -> ExpressionEvaluator:
    return ExpressionEvaluator(eval_timeout_sec=0)


def test_mro_subclasses_escape_is_blocked(evaluator: ExpressionEvaluator) -> None:
    with pytest.raises(ForbiddenOperationError):
        evaluator.evaluate("().__class__.__mro__[1].__subclasses__()", {})


def test_class_access_is_blocked(evaluator: ExpressionEvaluator) -> None:
    with pytest.raises(ForbiddenOperationError):
        evaluator.evaluate("(1).__class__", {})


def test_dict_access_is_blocked(evaluator: ExpressionEvaluator) -> None:
    with pytest.raises(ForbiddenOperationError):
        evaluator.evaluate("({}).__dict__", {})


def test_init_subclass_access_is_blocked(evaluator: ExpressionEvaluator) -> None:
    with pytest.raises(ForbiddenOperationError):
        evaluator.evaluate("(1).__init_subclass__", {})


def test_type_builtin_is_blocked(evaluator: ExpressionEvaluator) -> None:
    with pytest.raises(ForbiddenOperationError):
        evaluator.evaluate("type([])", {})


def test_object_builtin_is_blocked(evaluator: ExpressionEvaluator) -> None:
    with pytest.raises(ForbiddenOperationError):
        evaluator.evaluate("object()", {})


def test_help_builtin_is_blocked(evaluator: ExpressionEvaluator) -> None:
    with pytest.raises(ForbiddenOperationError):
        evaluator.evaluate("help(1)", {})


def test_super_builtin_is_blocked(evaluator: ExpressionEvaluator) -> None:
    with pytest.raises(ForbiddenOperationError):
        evaluator.evaluate("super()", {})


def test_classmethod_builtin_is_blocked(evaluator: ExpressionEvaluator) -> None:
    with pytest.raises(ForbiddenOperationError):
        evaluator.evaluate("classmethod(1)", {})


def test_staticmethod_builtin_is_blocked(evaluator: ExpressionEvaluator) -> None:
    with pytest.raises(ForbiddenOperationError):
        evaluator.evaluate("staticmethod(1)", {})


def test_property_builtin_is_blocked(evaluator: ExpressionEvaluator) -> None:
    with pytest.raises(ForbiddenOperationError):
        evaluator.evaluate("property(1)", {})


def test_breakpoint_builtin_is_blocked(evaluator: ExpressionEvaluator) -> None:
    with pytest.raises(ForbiddenOperationError):
        evaluator.evaluate("breakpoint()", {})


def test_memoryview_builtin_is_blocked(evaluator: ExpressionEvaluator) -> None:
    with pytest.raises(ForbiddenOperationError):
        evaluator.evaluate("memoryview(b'x')", {})


def test_mro_attribute_is_blocked(evaluator: ExpressionEvaluator) -> None:
    """``mro`` (non-dunder) is in the FORBIDDEN_NAMES set, both as a bare name
    and as an attribute lookup."""
    with pytest.raises(ForbiddenOperationError):
        evaluator.evaluate("mro()", {})


def test_arbitrary_dunder_attribute_is_blocked(evaluator: ExpressionEvaluator) -> None:
    """Any attribute whose name starts and ends with ``__`` is rejected."""
    with pytest.raises(ForbiddenOperationError):
        evaluator.evaluate("$json.__sizeof__", {"json": {"x": 1}})


def test_len_still_works(evaluator: ExpressionEvaluator) -> None:
    assert evaluator.evaluate("len([1,2,3])", {}) == 3


def test_dict_key_method_still_works(evaluator: ExpressionEvaluator) -> None:
    """Only dunders/private attrs are blocked — ordinary methods on a dict
    surfaced via ``$json`` should still resolve."""
    # $json is preprocessed to __ctx__["json"], which yields a real dict; the
    # attribute walker should let .get(...) through.
    ctx = {"json": {"name": "Alice"}}
    assert evaluator.evaluate("$json.name", ctx) == "Alice"


def test_non_dunder_method_on_custom_object_still_works(
    evaluator: ExpressionEvaluator,
) -> None:
    """A user-supplied object's ordinary (non-dunder) methods should still
    resolve via the ``$json`` channel — only dunders/private attrs are
    blocked."""

    class _Bag:
        def shout(self) -> str:
            return "BOO"

    ctx = {"json": {"bag": _Bag()}}
    out = evaluator.evaluate("$json.bag.shout()", ctx)
    assert out == "BOO"


def test_timeout_emits_warning_log(caplog: pytest.LogCaptureFixture) -> None:
    """Operators should see a warning when an expression actually hits the
    wall-clock cap, since the underlying worker thread cannot be pre-empted."""
    import time as _time

    import graph_caster.expression.evaluator as ev_mod

    def _slow(seconds: float) -> bool:
        _time.sleep(float(seconds))
        return True

    original = dict(ev_mod.ALLOWED_BUILTINS)
    ev_mod.ALLOWED_BUILTINS["slow_sleep"] = _slow
    try:
        ev = ExpressionEvaluator(eval_timeout_sec=0.05)
        with caplog.at_level(logging.WARNING, logger="graph_caster.expression.evaluator"):
            with pytest.raises(ExpressionTimeoutError):
                ev.evaluate("slow_sleep(0.5)", {})
        assert any("timeout" in rec.message.lower() for rec in caplog.records)
    finally:
        ev_mod.ALLOWED_BUILTINS.clear()
        ev_mod.ALLOWED_BUILTINS.update(original)


def test_evaluator_docstring_warns_about_thread_pre_emption() -> None:
    doc = ExpressionEvaluator.__doc__ or ""
    assert "wall-clock" in doc.lower()
    assert "subprocess" in doc.lower() or "container" in doc.lower()
