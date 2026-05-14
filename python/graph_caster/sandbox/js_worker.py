# Copyright GraphCaster. All Rights Reserved.

"""JavaScript worker bridge: spawns `node -e <script>` for the `code` node.

The user snippet runs inside a tiny Node.js wrapper that sets `args` from
argv and captures the value assigned to `result`.  stdout/stderr of the
snippet are forwarded verbatim; the final JSON result line is written on a
dedicated fd-4 equivalent (actually stdout of a wrapper) after snippet ends.

This module is imported by runner.py — it never runs directly.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from typing import Any

_MAX_STDOUT_BYTES = 512 * 1024
_MAX_STDERR_BYTES = 64 * 1024

_NODE_WRAPPER = r"""
(async () => {
  const argsRaw = process.env.__GC_ARGS__;
  let args;
  try { args = argsRaw ? JSON.parse(argsRaw) : null; } catch(e) { args = null; }
  let result = null;
  let _gcStdout = '';
  let _gcStderr = '';
  const origWrite = process.stdout.write.bind(process.stdout);
  const origErrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk, ...rest) => {
    _gcStdout += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    return origWrite(chunk, ...rest);
  };
  process.stderr.write = (chunk, ...rest) => {
    _gcStderr += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    return origErrWrite(chunk, ...rest);
  };
  try {
    const __USER_CODE__;
    process.stdout.write = origWrite;
    process.stderr.write = origErrWrite;
    process.__gc_result = JSON.stringify({ok: true, result, stdout: _gcStdout, stderr: _gcStderr});
  } catch(e) {
    process.stdout.write = origWrite;
    process.stderr.write = origErrWrite;
    process.__gc_result = JSON.stringify({ok: false, error: String(e), stdout: _gcStdout, stderr: _gcStderr});
  }
  process.stdout.write(process.__gc_result + '\n');
})();
"""


def _find_node() -> str | None:
    for candidate in ("node", "nodejs"):
        found = _which(candidate)
        if found:
            return found
    return None


def _which(name: str) -> str | None:
    import shutil
    return shutil.which(name)


def run_js(
    *,
    code: str,
    arguments: Any,
    timeout_sec: float,
    memory_limit_mb: int,
) -> dict[str, Any]:
    """Execute *code* in Node.js. Returns dict with ok/result/stdout/stderr."""
    node_bin = _find_node()
    if node_bin is None:
        return {
            "ok": False,
            "error": "js_runtime_not_found: node/nodejs not on PATH",
            "stdout": "",
            "stderr": "",
        }

    args_json = json.dumps(arguments, ensure_ascii=False)

    script = _NODE_WRAPPER.replace("const __USER_CODE__;", code)

    env = dict(os.environ)
    env["__GC_ARGS__"] = args_json

    kw: dict[str, Any] = {}
    if os.name == "nt":
        cf = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        if cf:
            kw["creationflags"] = cf

    try:
        proc = subprocess.run(
            [node_bin, "-e", script],
            capture_output=True,
            timeout=timeout_sec,
            env=env,
            check=False,
            **kw,
        )
    except subprocess.TimeoutExpired:
        return {
            "ok": False,
            "error": f"TimeoutError: exceeded {timeout_sec}s",
            "stdout": "",
            "stderr": "",
        }
    except OSError as exc:
        return {
            "ok": False,
            "error": f"spawn_error: {exc}",
            "stdout": "",
            "stderr": "",
        }

    raw_out = (proc.stdout or b"").decode("utf-8", errors="replace")
    raw_err = (proc.stderr or b"").decode("utf-8", errors="replace")

    last_line = ""
    for ln in reversed(raw_out.splitlines()):
        s = ln.strip()
        if s.startswith("{"):
            last_line = s
            break

    if not last_line:
        return {
            "ok": False,
            "error": f"empty_node_output (exit {proc.returncode})",
            "stdout": raw_out[:_MAX_STDOUT_BYTES],
            "stderr": raw_err[:_MAX_STDERR_BYTES],
        }

    try:
        parsed = json.loads(last_line)
    except json.JSONDecodeError as exc:
        return {
            "ok": False,
            "error": f"invalid_node_json: {exc}",
            "stdout": raw_out[:_MAX_STDOUT_BYTES],
            "stderr": raw_err[:_MAX_STDERR_BYTES],
        }

    if not isinstance(parsed, dict):
        return {
            "ok": False,
            "error": "node_bad_shape",
            "stdout": raw_out[:_MAX_STDOUT_BYTES],
            "stderr": raw_err[:_MAX_STDERR_BYTES],
        }

    return parsed
