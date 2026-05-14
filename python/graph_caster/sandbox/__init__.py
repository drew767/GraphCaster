# Copyright GraphCaster. All Rights Reserved.

"""Sandboxed code execution for `code` nodes (F67).

Best-effort isolation via AST-walk import blocking and subprocess isolation.
For strong security, run inside Docker or Firecracker — this sandbox is a
defence-in-depth layer, not a hard security boundary.
"""

from graph_caster.sandbox.runner import SandboxResult, run_code

__all__ = ["run_code", "SandboxResult"]
