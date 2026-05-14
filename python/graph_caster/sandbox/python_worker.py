# Copyright GraphCaster. All Rights Reserved.

"""Sandboxed Python worker: reads one JSON line from stdin, executes user code,
writes one JSON result line to stdout.

Protocol (stdin):
    {"code": str, "arguments": any, "timeout_sec": float}

Protocol (stdout):
    {"ok": true, "result": any, "stdout": str, "stderr": str}
    {"ok": false, "error": str, "stdout": str, "stderr": str}

Security: best-effort only. AST-walk blocks most stdlib escape routes but
cannot stop all resource abuse. For strong isolation use Docker/Firecracker.
"""

from __future__ import annotations

import ast
import io
import json
import math
import re
import sys
import traceback
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timezone
from random import Random

# ── forbidden import names ────────────────────────────────────────────────────

_BLOCKED_MODULES: frozenset[str] = frozenset(
    {
        "os",
        "os.path",
        "socket",
        "subprocess",
        "shutil",
        "ctypes",
        "pty",
        "resource",
        "signal",
        "fcntl",
        "mmap",
        "multiprocessing",
        "threading",
        "concurrent",
        "asyncio",
        "importlib",
        "pkgutil",
        "sys",
        "builtins",
        "gc",
        "inspect",
        "linecache",
        "tokenize",
        "dis",
        "code",
        "codeop",
        "compileall",
        "py_compile",
        "pdb",
        "faulthandler",
        "tracemalloc",
        "pickle",
        "shelve",
        "marshal",
        "tempfile",
        "glob",
        "fnmatch",
        "pathlib",
        "io",
        "nt",
        "posix",
        "winreg",
        "msvcrt",
    }
)


class _ImportBlocker(ast.NodeVisitor):
    """Walk AST and raise if any forbidden import is present."""

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            root = alias.name.split(".")[0]
            if root in _BLOCKED_MODULES or alias.name in _BLOCKED_MODULES:
                raise PermissionError(f"sandbox_violation: import '{alias.name}' is blocked")
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        if node.module is None:
            return
        root = node.module.split(".")[0]
        if root in _BLOCKED_MODULES or node.module in _BLOCKED_MODULES:
            raise PermissionError(f"sandbox_violation: from '{node.module}' import is blocked")
        for alias in node.names:
            if alias.name == "__import__":
                raise PermissionError("sandbox_violation: __import__ is blocked")
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        if isinstance(node.func, ast.Name) and node.func.id == "__import__":
            raise PermissionError("sandbox_violation: __import__() is blocked")
        if isinstance(node.func, ast.Attribute) and node.func.attr == "__import__":
            raise PermissionError("sandbox_violation: __import__() is blocked")
        self.generic_visit(node)


def _check_ast(code: str) -> None:
    try:
        tree = ast.parse(code, "<sandbox>", "exec")
    except SyntaxError as exc:
        raise SyntaxError(str(exc)) from exc
    _ImportBlocker().visit(tree)


# ── safe globals ─────────────────────────────────────────────────────────────

def _safe_globals(arguments: object) -> dict[str, object]:
    _rng = Random()

    return {
        "__builtins__": {
            "abs": abs,
            "all": all,
            "any": any,
            "bin": bin,
            "bool": bool,
            "bytes": bytes,
            "chr": chr,
            "dict": dict,
            "divmod": divmod,
            "enumerate": enumerate,
            "filter": filter,
            "float": float,
            "format": format,
            "frozenset": frozenset,
            "hash": hash,
            "hex": hex,
            "int": int,
            "isinstance": isinstance,
            "issubclass": issubclass,
            "iter": iter,
            "len": len,
            "list": list,
            "map": map,
            "max": max,
            "min": min,
            "next": next,
            "oct": oct,
            "ord": ord,
            "pow": pow,
            "print": print,
            "range": range,
            "repr": repr,
            "reversed": reversed,
            "round": round,
            "set": set,
            "slice": slice,
            "sorted": sorted,
            "str": str,
            "sum": sum,
            "tuple": tuple,
            "type": type,
            "zip": zip,
            "True": True,
            "False": False,
            "None": None,
            "ArithmeticError": ArithmeticError,
            "AssertionError": AssertionError,
            "Exception": Exception,
            "IndexError": IndexError,
            "KeyError": KeyError,
            "MemoryError": MemoryError,
            "NameError": NameError,
            "NotImplementedError": NotImplementedError,
            "OverflowError": OverflowError,
            "RuntimeError": RuntimeError,
            "StopIteration": StopIteration,
            "TypeError": TypeError,
            "ValueError": ValueError,
            "ZeroDivisionError": ZeroDivisionError,
        },
        "args": arguments,
        "result": None,
        "math": math,
        "json": json,
        "re": re,
        "datetime": datetime,
        "timezone": timezone,
        "random": _rng,
    }


# ── resource limits (POSIX only) ─────────────────────────────────────────────

def _apply_resource_limits(memory_limit_mb: int) -> None:
    try:
        import resource  # noqa: PLC0415 — only on POSIX
        limit_bytes = memory_limit_mb * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (limit_bytes, limit_bytes))
    except (ImportError, AttributeError, ValueError):
        pass


# ── main worker ──────────────────────────────────────────────────────────────

def main() -> None:
    raw = sys.stdin.buffer.readline()
    if not raw:
        sys.stdout.write(json.dumps({"ok": False, "error": "no_stdin", "stdout": "", "stderr": ""}) + "\n")
        sys.stdout.flush()
        return

    try:
        payload: object = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        sys.stdout.write(
            json.dumps({"ok": False, "error": f"stdin_json:{exc}", "stdout": "", "stderr": ""}, ensure_ascii=False) + "\n"
        )
        sys.stdout.flush()
        return

    if not isinstance(payload, dict):
        sys.stdout.write(json.dumps({"ok": False, "error": "payload_not_object", "stdout": "", "stderr": ""}) + "\n")
        sys.stdout.flush()
        return

    code = payload.get("code")
    if not isinstance(code, str):
        sys.stdout.write(json.dumps({"ok": False, "error": "missing_code", "stdout": "", "stderr": ""}) + "\n")
        sys.stdout.flush()
        return

    arguments = payload.get("arguments")
    memory_limit_mb = int(payload.get("memory_limit_mb", 256))

    _apply_resource_limits(memory_limit_mb)

    try:
        _check_ast(code)
    except PermissionError as exc:
        sys.stdout.write(
            json.dumps({"ok": False, "error": str(exc), "stdout": "", "stderr": ""}, ensure_ascii=False) + "\n"
        )
        sys.stdout.flush()
        return
    except SyntaxError as exc:
        sys.stdout.write(
            json.dumps({"ok": False, "error": f"syntax_error:{exc}", "stdout": "", "stderr": ""}, ensure_ascii=False) + "\n"
        )
        sys.stdout.flush()
        return

    glb = _safe_globals(arguments)
    local_ns: dict[str, object] = {}

    stdout_buf = io.StringIO()
    stderr_buf = io.StringIO()

    try:
        compiled = compile(code, "<sandbox>", "exec")
        with redirect_stdout(stdout_buf), redirect_stderr(stderr_buf):
            exec(compiled, glb, local_ns)  # noqa: S102
    except MemoryError:
        sys.stdout.write(
            json.dumps(
                {
                    "ok": False,
                    "error": "MemoryError: memory limit exceeded",
                    "stdout": stdout_buf.getvalue(),
                    "stderr": stderr_buf.getvalue(),
                },
                ensure_ascii=False,
            ) + "\n"
        )
        sys.stdout.flush()
        return
    except BaseException as exc:
        sys.stdout.write(
            json.dumps(
                {
                    "ok": False,
                    "error": f"{type(exc).__name__}: {exc}",
                    "traceback": traceback.format_exc(),
                    "stdout": stdout_buf.getvalue(),
                    "stderr": stderr_buf.getvalue(),
                },
                ensure_ascii=False,
                default=str,
            ) + "\n"
        )
        sys.stdout.flush()
        return

    res = local_ns.get("result", glb.get("result"))

    out_obj: dict[str, object] = {
        "ok": True,
        "result": res,
        "stdout": stdout_buf.getvalue(),
        "stderr": stderr_buf.getvalue(),
    }
    try:
        line_out = json.dumps(out_obj, ensure_ascii=False, default=str) + "\n"
    except (TypeError, ValueError) as ser_exc:
        sys.stdout.write(
            json.dumps(
                {"ok": False, "error": f"result_not_jsonable:{ser_exc}", "stdout": stdout_buf.getvalue(), "stderr": stderr_buf.getvalue()},
                ensure_ascii=False,
                default=str,
            ) + "\n"
        )
        sys.stdout.flush()
        return

    sys.stdout.write(line_out)
    sys.stdout.flush()


if __name__ == "__main__":
    main()
