# Copyright GraphCaster. All Rights Reserved.

"""Backwards-compatible shim. Canonical implementation lives in ``nodes/rag_index.py``."""

from graph_caster.nodes.rag_index import (  # noqa: F401
    RagIndexNode,
    execute_rag_index,
    rag_index_has_valid_config,
    rag_index_structure_invalid_reason,
)
