# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from graph_caster.python_code_exec import execute_python_code


def test_execute_python_code_success_sets_last_result_and_process_complete() -> None:
    emitted: list[tuple[str, dict]] = []

    def emit(name: str, **kwargs: object) -> None:
        emitted.append((name, kwargs))

    ctx: dict = {}
    ok, out = execute_python_code(
        node_id="n1",
        graph_id="g1",
        data={"code": "result = 1 + 1"},
        ctx=ctx,
        emit=lambda *a, **k: emit(*a, **k),
    )

    assert ok is True
    assert out["processResult"]["success"] is True
    assert out["codeResult"]["success"] is True
    assert ctx["last_result"] == 2
    names = [x[0] for x in emitted]
    assert "process_complete" in names
    complete = next(kw for n, kw in emitted if n == "process_complete")
    assert complete["success"] is True
    assert complete["exitCode"] == 0


def test_execute_python_code_uses_dunder_result() -> None:
    emitted: list[tuple[str, dict]] = []

    def emit(name: str, **kwargs: object) -> None:
        emitted.append((name, kwargs))

    ctx: dict = {}
    ok, out = execute_python_code(
        node_id="n1",
        graph_id="g1",
        data={"code": "__result__ = {'ok': True}"},
        ctx=ctx,
        emit=lambda *a, **k: emit(*a, **k),
    )
    assert ok is True
    assert ctx["last_result"] == {"ok": True}
    assert out["codeResult"]["result"] == {"ok": True}


def test_execute_python_code_empty_is_not_success() -> None:
    emitted: list[tuple[str, dict]] = []

    def emit(name: str, **kwargs: object) -> None:
        emitted.append((name, kwargs))

    ctx: dict = {}
    ok, out = execute_python_code(
        node_id="n1",
        graph_id="g1",
        data={"code": ""},
        ctx=ctx,
        emit=lambda *a, **k: emit(*a, **k),
    )
    assert ok is False
    assert out["processResult"]["success"] is False
    assert out["codeResult"]["error"] == "python_code_empty"
    assert any(n == "process_complete" for n, _ in emitted)


def test_execute_python_code_merges_run_variables() -> None:
    emitted: list[tuple[str, dict]] = []

    def emit(name: str, **kwargs: object) -> None:
        emitted.append((name, kwargs))

    ctx: dict = {}
    ok, out = execute_python_code(
        node_id="n1",
        graph_id="g1",
        data={"code": "result = 1\n__run_variables__ = {'x': 42}"},
        ctx=ctx,
        emit=lambda *a, **k: emit(*a, **k),
    )
    assert ok is True
    assert out.get("runVariables") == {"x": 42}


def test_execute_python_code_user_error_emits_complete() -> None:
    emitted: list[tuple[str, dict]] = []

    def emit(name: str, **kwargs: object) -> None:
        emitted.append((name, kwargs))

    ctx: dict = {}
    ok, out = execute_python_code(
        node_id="n1",
        graph_id="g1",
        data={"code": "result = 1 // 0"},
        ctx=ctx,
        emit=lambda *a, **k: emit(*a, **k),
    )
    assert ok is False
    assert out["processResult"]["success"] is False
    assert ctx["last_result"] is False
    assert any(n == "process_complete" for n, _ in emitted)
