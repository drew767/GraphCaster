# Copyright GraphCaster. All Rights Reserved.

"""Backwards-compatible shim. Canonical implementation lives in ``nodes/set_variable.py``."""

from graph_caster.nodes.set_variable import (  # noqa: F401
    SetVariableNode,
    execute_set_variable,
    normalized_operation,
    set_variable_has_valid_config,
    set_variable_structure_invalid_reason,
    variable_name_from_data,
)
