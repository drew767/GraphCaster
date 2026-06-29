# Copyright GraphCaster. All Rights Reserved.

"""Backwards-compatible shim. Canonical implementation lives in ``nodes/python_code.py``."""

from graph_caster.nodes import python_code as _impl
from graph_caster.nodes.python_code import (  # noqa: F401
    PythonCodeNode,
    build_worker_context,
    execute_python_code,
    redact_python_code_data_for_execute,
)

# Re-export ``subprocess`` so legacy tests that patch
# ``graph_caster.python_code_exec.subprocess.run`` reach the canonical implementation.
subprocess = _impl.subprocess
