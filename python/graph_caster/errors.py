# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from enum import Enum


class ErrorCode(str, Enum):
    """Structured GraphCaster error codes (GCxxxx) for runners, logs, and UI mapping."""

    # GC1xxx — document / parse (reserved)
    GC1001 = "GC1001"
    # GC2xxx — graph structure / node data (pre-run)
    GC2001 = "GC2001"  # task: missing executable (command/argv/gcCursorAgent)
    GC2002 = "GC2002"  # gcCursorAgent preset invalid
    GC2010 = "GC2010"  # mcp_tool: invalid configuration
    GC2011 = "GC2011"  # llm_agent: missing command/argv
    # GC3xxx — runtime
    GC3001 = "GC3001"  # process failed / timeout (reserved for future uniform wrapping)
    # GC4xxx — network / broker
    GC4001 = "GC4001"
    # GC5xxx — workspace I/O
    GC5001 = "GC5001"
