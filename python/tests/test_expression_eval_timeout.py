# Copyright GraphCaster. All Rights Reserved.

"""Wall-clock timeout for expression evaluation (sandbox, best-effort)."""

from __future__ import annotations

import time

import pytest

from graph_caster.expression.errors import ExpressionTimeoutError
from graph_caster.expression.evaluator import ExpressionEvaluator


def test_evaluate_completes_under_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    import graph_caster.expression.evaluator as ev_mod

    def _slow(seconds: float) -> bool:
        time.sleep(float(seconds))
        return True

    monkeypatch.setitem(ev_mod.ALLOWED_BUILTINS, "slow_sleep", _slow)
    ev = ExpressionEvaluator(eval_timeout_sec=2.0)
    assert ev.evaluate("slow_sleep(0.05)", {}) is True


def test_evaluate_raises_when_exceeding_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    import graph_caster.expression.evaluator as ev_mod

    def _slow(seconds: float) -> bool:
        time.sleep(float(seconds))
        return True

    monkeypatch.setitem(ev_mod.ALLOWED_BUILTINS, "slow_sleep", _slow)
    ev = ExpressionEvaluator(eval_timeout_sec=0.08)
    with pytest.raises(ExpressionTimeoutError):
        ev.evaluate("slow_sleep(0.5)", {})


def test_eval_timeout_zero_disables_cap(monkeypatch: pytest.MonkeyPatch) -> None:
    import graph_caster.expression.evaluator as ev_mod

    def _slow(seconds: float) -> bool:
        time.sleep(float(seconds))
        return True

    monkeypatch.setitem(ev_mod.ALLOWED_BUILTINS, "slow_sleep", _slow)
    ev = ExpressionEvaluator(eval_timeout_sec=0)
    assert ev.evaluate("slow_sleep(0.08)", {}) is True
