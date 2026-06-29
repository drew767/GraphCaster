# Copyright GraphCaster. All Rights Reserved.

"""Backwards-compatible shim. Canonical implementation lives in ``nodes/rag_query.py``."""

from graph_caster.nodes.rag_query import (  # noqa: F401
    RagQueryNode,
    execute_rag_query,
    redact_rag_query_data_for_execute,
)
