# Copyright GraphCaster. All Rights Reserved.

"""Tests for F67 CodeNode and sandbox runner."""

from __future__ import annotations

import sys
import pytest

from graph_caster.sandbox.runner import run_code, SandboxResult


# ── Python sandbox tests ──────────────────────────────────────────────────────

class TestPythonSandbox:
    def test_basic_arithmetic_with_args(self) -> None:
        sr = run_code(language="python", code="result = args['x'] + 1", arguments={"x": 2})
        assert sr.ok is True
        assert sr.result == 3

    def test_print_captured_in_stdout(self) -> None:
        sr = run_code(language="python", code='print("hi")\nresult = "done"', arguments=None)
        assert sr.ok is True
        assert sr.result == "done"
        assert "hi" in sr.stdout

    def test_forbidden_import_os(self) -> None:
        sr = run_code(language="python", code="import os\nresult = os.getcwd()", arguments=None)
        assert sr.ok is False
        assert "sandbox_violation" in sr.error or "blocked" in sr.error

    def test_forbidden_import_socket(self) -> None:
        sr = run_code(language="python", code="import socket", arguments=None)
        assert sr.ok is False
        assert "sandbox_violation" in sr.error or "blocked" in sr.error

    def test_forbidden_import_subprocess(self) -> None:
        sr = run_code(language="python", code="import subprocess", arguments=None)
        assert sr.ok is False
        assert "sandbox_violation" in sr.error or "blocked" in sr.error

    def test_forbidden_dunder_import(self) -> None:
        sr = run_code(language="python", code="__import__('os')", arguments=None)
        assert sr.ok is False

    def test_timeout_infinite_loop(self) -> None:
        sr = run_code(language="python", code="while True: pass", arguments=None, timeout_sec=2)
        assert sr.ok is False
        assert sr.timed_out is True

    def test_result_is_dict(self) -> None:
        sr = run_code(language="python", code="result = {'a': 1, 'b': 2}", arguments=None)
        assert sr.ok is True
        assert sr.result == {"a": 1, "b": 2}

    def test_args_passed_correctly(self) -> None:
        sr = run_code(language="python", code="result = args", arguments={"key": "val"})
        assert sr.ok is True
        assert sr.result == {"key": "val"}

    def test_math_module_available(self) -> None:
        sr = run_code(language="python", code="result = math.floor(3.7)", arguments=None)
        assert sr.ok is True
        assert sr.result == 3

    def test_json_module_available(self) -> None:
        sr = run_code(language="python", code='result = json.dumps({"x": 1})', arguments=None)
        assert sr.ok is True
        assert '"x"' in sr.result

    def test_syntax_error_returns_failure(self) -> None:
        sr = run_code(language="python", code="def foo(:\n    pass", arguments=None)
        assert sr.ok is False

    def test_runtime_error_captured(self) -> None:
        sr = run_code(language="python", code="result = 1 / 0", arguments=None)
        assert sr.ok is False
        assert "ZeroDivisionError" in sr.error or "division by zero" in sr.error

    def test_stdout_and_result_together(self) -> None:
        code = 'print("line1")\nprint("line2")\nresult = 42'
        sr = run_code(language="python", code=code, arguments=None)
        assert sr.ok is True
        assert sr.result == 42
        assert "line1" in sr.stdout
        assert "line2" in sr.stdout

    def test_no_result_assignment_returns_none(self) -> None:
        sr = run_code(language="python", code="x = 1 + 1", arguments=None)
        assert sr.ok is True
        assert sr.result is None

    def test_sum_example(self) -> None:
        code = "result = {'sum': args['x'] + args['y']}"
        sr = run_code(language="python", code=code, arguments={"x": 3, "y": 4})
        assert sr.ok is True
        assert sr.result == {"sum": 7}


@pytest.mark.skipif(sys.platform == "win32", reason="POSIX resource limits only")
class TestMemoryLimitPosix:
    def test_memory_limit_oom(self) -> None:
        # Allocate ~1 GB — should trigger MemoryError in the sandbox
        code = "result = 'A' * (1024 * 1024 * 1024)"
        sr = run_code(language="python", code=code, arguments=None, memory_limit_mb=64)
        assert sr.ok is False
        assert "MemoryError" in sr.error or sr.timed_out


# ── JavaScript sandbox tests ──────────────────────────────────────────────────

def _node_available() -> bool:
    import shutil
    return shutil.which("node") is not None or shutil.which("nodejs") is not None


@pytest.mark.skipif(not _node_available(), reason="node not on PATH")
class TestJavaScriptSandbox:
    def test_basic_multiplication(self) -> None:
        sr = run_code(language="javascript", code="result = args.x * 2", arguments={"x": 3})
        assert sr.ok is True
        assert sr.result == 6

    def test_string_result(self) -> None:
        sr = run_code(language="javascript", code="result = 'hello'", arguments=None)
        assert sr.ok is True
        assert sr.result == "hello"

    def test_args_dict_access(self) -> None:
        sr = run_code(language="javascript", code="result = args['key']", arguments={"key": "value"})
        assert sr.ok is True
        assert sr.result == "value"


# ── CodeNode integration tests ────────────────────────────────────────────────

class TestCodeNodeRun:
    def _make_ctx(self) -> object:
        from unittest.mock import MagicMock
        return MagicMock()

    def _run_node(self, code: str, arguments=None, language="python", timeout=30.0) -> dict:
        import asyncio
        from graph_caster.nodes.code import CodeNode

        node = CodeNode()
        ctx = self._make_ctx()
        coro = node.run(ctx, language=language, code=code, arguments=arguments, timeoutSec=timeout, memoryLimitMb=256)
        return asyncio.run(coro)

    def test_node_returns_result(self) -> None:
        out = self._run_node("result = args['x'] + 1", arguments={"x": 10})
        assert out["result"] == 11

    def test_node_stdout_captured(self) -> None:
        out = self._run_node('print("hello from node")\nresult = 1')
        assert "hello from node" in out["stdout"]

    def test_node_forbidden_import_raises_permission_error(self) -> None:
        with pytest.raises((PermissionError, RuntimeError)):
            self._run_node("import os\nresult = os.getcwd()")

    def test_node_timeout_raises_timeout_error(self) -> None:
        with pytest.raises(TimeoutError):
            self._run_node("while True: pass", timeout=2.0)

    def test_node_registered(self) -> None:
        from graph_caster.node_api.registry import get_registered
        from graph_caster.nodes.code import CodeNode

        cls = get_registered("code", 1.0)
        assert cls is CodeNode

    def test_node_sum_dict_example(self) -> None:
        code = "result = {'sum': args['x'] + args['y'], 'diff': args['x'] - args['y']}"
        out = self._run_node(code, arguments={"x": 10, "y": 3})
        assert out["result"] == {"sum": 13, "diff": 7}
