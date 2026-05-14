# Copyright GraphCaster. All Rights Reserved.

"""Code node (F67): run a Python or JavaScript snippet in an isolated subprocess.

The snippet executes inside a sandboxed child process:
  - Python: AST-walk blocks dangerous imports; subprocess isolation; optional
    POSIX resource limits (memory via RLIMIT_AS, timeout via communicate).
  - JavaScript: subprocess isolation via `node -e`; requires Node.js on PATH.

Security: best-effort.  For hard multi-tenant isolation use Docker/Firecracker.
"""

from __future__ import annotations

from typing import Any, ClassVar

from graph_caster.node_api.base import GraphCasterNode
from graph_caster.node_api.fields import Input, Output
from graph_caster.node_api.registry import register_class


class CodeNode(GraphCasterNode):
    type: ClassVar[str] = "code"
    version: ClassVar[float] = 1.0
    display_name: ClassVar[str] = "Code"
    description: ClassVar[str] = "Run a Python or JavaScript snippet in an isolated subprocess"
    category: ClassVar[str] = "general"
    icon: ClassVar[str] = "code"

    inputs: ClassVar[list[Input]] = [
        Input(
            "language",
            str,
            options=["python", "javascript"],
            default="python",
            description="Runtime language for the snippet",
        ),
        Input(
            "code",
            str,
            required=True,
            multiline=True,
            description="Snippet source code. In Python: assign `result`. In JS: assign `result`.",
        ),
        Input(
            "arguments",
            "json",
            default=None,
            description="Passed as `args` global inside the snippet",
        ),
        Input(
            "timeoutSec",
            float,
            default=30.0,
            range=(1, 600),
            description="Wall-clock timeout in seconds",
        ),
        Input(
            "memoryLimitMb",
            int,
            default=256,
            range=(32, 8192),
            description="Soft memory limit in MiB (POSIX only; Windows: ignored)",
        ),
    ]
    outputs: ClassVar[list[Output]] = [
        Output("result", "json", description="Value assigned to `result` by the snippet"),
        Output("stdout", str, description="Captured standard output of the snippet"),
        Output("stderr", str, description="Captured standard error of the snippet"),
    ]

    async def run(self, ctx: Any, **kwargs: Any) -> dict[str, Any]:
        from graph_caster.sandbox.runner import run_code

        language: str = str(kwargs.get("language") or "python").lower()
        code: str = str(kwargs.get("code") or "")
        arguments = kwargs.get("arguments")

        try:
            timeout_sec = float(kwargs.get("timeoutSec") or 30.0)
        except (TypeError, ValueError):
            timeout_sec = 30.0

        try:
            memory_limit_mb = int(kwargs.get("memoryLimitMb") or 256)
        except (TypeError, ValueError):
            memory_limit_mb = 256

        sr = run_code(
            language=language,
            code=code,
            arguments=arguments,
            timeout_sec=timeout_sec,
            memory_limit_mb=memory_limit_mb,
        )

        if not sr.ok:
            error_msg = sr.error or "sandbox_error"
            if sr.timed_out:
                raise TimeoutError(f"Code node timed out after {timeout_sec}s: {error_msg}")
            if "MemoryError" in error_msg:
                raise MemoryError(error_msg)
            if "sandbox_violation" in error_msg or "import" in error_msg.lower():
                raise PermissionError(error_msg)
            raise RuntimeError(f"Code execution failed: {error_msg}")

        return {
            "result": sr.result,
            "stdout": sr.stdout,
            "stderr": sr.stderr,
        }


register_class(CodeNode)
