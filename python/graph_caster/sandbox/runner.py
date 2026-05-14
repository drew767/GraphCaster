# Copyright GraphCaster. All Rights Reserved.

"""Main sandbox execution entry point for the `code` node (F67).

Spawns python_worker.py (or js_worker.py) as a subprocess, passes the user
snippet via stdin JSON, collects result/stdout/stderr from stdout JSON.

Security notes:
  - Python sandbox: AST-walk blocks most import escape routes + subprocess
    isolation.  Memory limit applied via resource.setrlimit (POSIX only);
    on Windows only the subprocess.communicate timeout applies.
  - JavaScript sandbox: subprocess isolation only — no AST checks; rely on
    Node.js's own module system (no require() is available in -e scripts by
    default in newer Node).
  - For production use-cases requiring hard multi-tenant isolation, run the
    whole GraphCaster instance inside Docker/Firecracker.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass, field
from typing import Any

_WORKER_MODULE = "graph_caster.sandbox.python_worker"
_MAX_STDOUT_CAPTURE = 512 * 1024
_MAX_STDERR_CAPTURE = 64 * 1024


@dataclass
class SandboxResult:
    ok: bool
    result: Any = None
    stdout: str = ""
    stderr: str = ""
    error: str = ""
    timed_out: bool = False
    duration_ms: int = 0


def _python_worker_argv() -> list[str]:
    return [sys.executable, "-I", "-m", _WORKER_MODULE]


def _spawn_kw() -> dict[str, Any]:
    kw: dict[str, Any] = {}
    if os.name == "nt":
        cf = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        if cf:
            kw["creationflags"] = cf
    return kw


def run_code(
    *,
    language: str,
    code: str,
    arguments: Any = None,
    timeout_sec: float = 30.0,
    memory_limit_mb: int = 256,
) -> SandboxResult:
    """Run *code* in an isolated subprocess. Returns a SandboxResult."""
    language = (language or "python").lower()
    timeout_sec = max(1.0, float(timeout_sec))
    memory_limit_mb = max(32, int(memory_limit_mb))

    if language == "javascript":
        return _run_js(code=code, arguments=arguments, timeout_sec=timeout_sec, memory_limit_mb=memory_limit_mb)
    return _run_python(code=code, arguments=arguments, timeout_sec=timeout_sec, memory_limit_mb=memory_limit_mb)


def _run_python(
    *,
    code: str,
    arguments: Any,
    timeout_sec: float,
    memory_limit_mb: int,
) -> SandboxResult:
    payload = json.dumps(
        {"code": code, "arguments": arguments, "timeout_sec": timeout_sec, "memory_limit_mb": memory_limit_mb},
        ensure_ascii=False,
        default=str,
    ) + "\n"

    t0 = time.monotonic()
    try:
        proc = subprocess.run(
            _python_worker_argv(),
            input=payload,
            capture_output=True,
            text=True,
            timeout=timeout_sec,
            check=False,
            **_spawn_kw(),
        )
    except subprocess.TimeoutExpired:
        dur_ms = int((time.monotonic() - t0) * 1000)
        return SandboxResult(
            ok=False,
            error=f"TimeoutError: exceeded {timeout_sec}s",
            timed_out=True,
            duration_ms=dur_ms,
        )
    except OSError as exc:
        return SandboxResult(ok=False, error=f"spawn_error: {exc}")

    dur_ms = int((time.monotonic() - t0) * 1000)
    return _parse_worker_output(proc.stdout or "", proc.stderr or "", proc.returncode, dur_ms)


def _run_js(
    *,
    code: str,
    arguments: Any,
    timeout_sec: float,
    memory_limit_mb: int,
) -> SandboxResult:
    from graph_caster.sandbox.js_worker import run_js

    t0 = time.monotonic()
    parsed = run_js(code=code, arguments=arguments, timeout_sec=timeout_sec, memory_limit_mb=memory_limit_mb)
    dur_ms = int((time.monotonic() - t0) * 1000)

    if not isinstance(parsed, dict):
        return SandboxResult(ok=False, error="js_worker_bad_response", duration_ms=dur_ms)

    if not parsed.get("ok"):
        err = str(parsed.get("error") or "js_error")
        timed_out = "TimeoutError" in err or "timeout" in err.lower()
        return SandboxResult(
            ok=False,
            error=err,
            stdout=str(parsed.get("stdout") or "")[:_MAX_STDOUT_CAPTURE],
            stderr=str(parsed.get("stderr") or "")[:_MAX_STDERR_CAPTURE],
            timed_out=timed_out,
            duration_ms=dur_ms,
        )

    return SandboxResult(
        ok=True,
        result=parsed.get("result"),
        stdout=str(parsed.get("stdout") or "")[:_MAX_STDOUT_CAPTURE],
        stderr=str(parsed.get("stderr") or "")[:_MAX_STDERR_CAPTURE],
        duration_ms=dur_ms,
    )


def _parse_worker_output(raw_stdout: str, raw_stderr: str, returncode: int, dur_ms: int) -> SandboxResult:
    first_json = ""
    for ln in (raw_stdout or "").splitlines():
        s = ln.strip()
        if s.startswith("{"):
            first_json = s
            break

    stderr_tail = (raw_stderr or "")[:_MAX_STDERR_CAPTURE]

    if returncode != 0 and not first_json:
        return SandboxResult(
            ok=False,
            error=f"worker_exit_{returncode}",
            stderr=stderr_tail,
            duration_ms=dur_ms,
        )

    if not first_json:
        return SandboxResult(
            ok=False,
            error="empty_worker_stdout",
            stderr=stderr_tail,
            duration_ms=dur_ms,
        )

    try:
        parsed = json.loads(first_json)
    except json.JSONDecodeError as exc:
        return SandboxResult(
            ok=False,
            error=f"invalid_worker_json: {exc}",
            stderr=stderr_tail,
            duration_ms=dur_ms,
        )

    if not isinstance(parsed, dict):
        return SandboxResult(ok=False, error="worker_bad_shape", stderr=stderr_tail, duration_ms=dur_ms)

    out_stdout = str(parsed.get("stdout") or "")[:_MAX_STDOUT_CAPTURE]
    out_stderr = str(parsed.get("stderr") or stderr_tail)[:_MAX_STDERR_CAPTURE]

    if not parsed.get("ok"):
        err = str(parsed.get("error") or "worker_error")
        timed_out = "TimeoutError" in err or "MemoryError" in err
        return SandboxResult(
            ok=False,
            error=err,
            stdout=out_stdout,
            stderr=out_stderr,
            timed_out=timed_out,
            duration_ms=dur_ms,
        )

    return SandboxResult(
        ok=True,
        result=parsed.get("result"),
        stdout=out_stdout,
        stderr=out_stderr,
        duration_ms=dur_ms,
    )
