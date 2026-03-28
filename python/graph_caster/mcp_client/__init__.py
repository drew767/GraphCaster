# Copyright GraphCaster. All Rights Reserved.

"""MCP client for the ``mcp_tool`` node (direction B, doc/COMPETITIVE_ANALYSIS §34).

Runtime uses the official ``mcp`` SDK (same stack as ``graph_caster.mcp_server``):
``ClientSession``, ``stdio_client`` in ``mcp.client.stdio``, ``streamable_http_client``
in ``mcp.client.streamable_http``. One short-lived session per node visit (MVP).
"""

from graph_caster.mcp_client.client import (
    format_mcp_result_preview,
    normalize_mcp_provider_outcome,
    redact_mcp_tool_arguments_for_event,
    redact_mcp_tool_data_for_execute,
    run_mcp_tool_call,
)

__all__ = [
    "format_mcp_result_preview",
    "normalize_mcp_provider_outcome",
    "redact_mcp_tool_arguments_for_event",
    "redact_mcp_tool_data_for_execute",
    "run_mcp_tool_call",
]
