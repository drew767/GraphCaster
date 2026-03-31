# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from typing import Protocol, runtime_checkable


@runtime_checkable
class SecretsProvider(Protocol):
    """Resolve workspace-scoped secrets for **envKeys** (task / mcp_tool, etc.)."""

    def as_mapping(self) -> dict[str, str]:
        """Return all key-value pairs available from this provider (loaded once per run)."""
        ...

    def fingerprint(self) -> str:
        """Short stable id for step-cache invalidation when the secret backend changes."""
        ...
