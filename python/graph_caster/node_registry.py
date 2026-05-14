# Copyright GraphCaster. All Rights Reserved.

"""Versioned node-type registry (F47).

Inspired by n8n's VersionedNodeType pattern: a single node-type name can have
multiple handler implementations.  Old graphs that carry ``typeVersion: 1`` keep
working even when version 2 becomes the default.

Usage (registering handlers)
-----------------------------
    from graph_caster.node_registry import NodeRegistry

    registry = NodeRegistry()
    registry.register("task", 1, my_task_v1_handler, default=True)
    registry.register("task", 2, my_task_v2_handler, default=True)  # marks v2 as new default

    handler = registry.resolve("task", None)   # → my_task_v2_handler (latest default)
    handler = registry.resolve("task", 1)      # → my_task_v1_handler
    handler = registry.resolve("task", 1.5)    # → my_task_v1_handler (nearest lower)

The ``node_version_fallback`` event is emitted via ``on_fallback`` callback when
the requested version is not found exactly and a lower version is used instead.
"""

from __future__ import annotations

import logging
import warnings
from collections.abc import Callable
from typing import Any

__all__ = [
    "NodeRegistry",
    "UnknownNodeVersion",
    "UnknownNodeType",
    "get_default_registry",
]

_LOG = logging.getLogger(__name__)


class UnknownNodeType(KeyError):
    """Raised when a node type has no registered handlers."""


class UnknownNodeVersion(KeyError):
    """Raised when no suitable version is found for a node type."""


class NodeRegistry:
    """Registry of versioned node-type handler callables.

    Each entry: ``(type_name, version) → handler``.
    The *default* version is the one returned when ``version=None`` is requested.
    If no default is explicitly set, the highest registered version is used.
    """

    def __init__(self) -> None:
        # {type_name: {version: handler}}
        self._handlers: dict[str, dict[float, Callable[..., Any]]] = {}
        # Explicit defaults set via register(..., default=True).
        # {type_name: version}
        self._explicit_defaults: dict[str, float] = {}
        # Optional callback: (type_name, requested_version, used_version) → None
        self._fallback_listener: Callable[[str, float, float], None] | None = None

    # ------------------------------------------------------------------
    # Configuration
    # ------------------------------------------------------------------

    def set_fallback_listener(
        self, listener: Callable[[str, float, float], None] | None
    ) -> None:
        """Set a callable invoked whenever a version fallback occurs.

        The callback receives ``(type_name, requested_version, used_version)``.
        Use this to emit ``node_version_fallback`` events to the run stream.
        """
        self._fallback_listener = listener

    # ------------------------------------------------------------------
    # Registration
    # ------------------------------------------------------------------

    def register(
        self,
        type_name: str,
        version: float,
        handler: Callable[..., Any],
        *,
        default: bool = False,
    ) -> None:
        """Register *handler* for *type_name* at *version*.

        Parameters
        ----------
        type_name:
            Node type string (e.g. ``"task"``, ``"llm_agent"``).
        version:
            Numeric version (e.g. ``1``, ``1.5``, ``2``).  Must be >= 1.
        handler:
            Callable invoked when this type+version is resolved.  Signature is
            intentionally unspecified — callers are responsible for consistency.
        default:
            When ``True``, mark this version as the default for ``resolve(…, None)``.
            If multiple registrations set ``default=True``, the *last* one wins.
        """
        if version < 1:
            raise ValueError(f"version must be >= 1, got {version!r}")
        if not callable(handler):
            raise TypeError(f"handler must be callable, got {type(handler)!r}")
        type_versions = self._handlers.setdefault(type_name, {})
        type_versions[version] = handler
        if default:
            self._explicit_defaults[type_name] = version

    # ------------------------------------------------------------------
    # Resolution
    # ------------------------------------------------------------------

    def resolve(self, type_name: str, version: float | None) -> Callable[..., Any]:
        """Return the handler for *type_name* at *version*.

        Parameters
        ----------
        type_name:
            Node type string.
        version:
            Requested version number, or ``None`` to use the default.

        Returns
        -------
        Callable
            The registered handler.

        Raises
        ------
        UnknownNodeType
            When *type_name* has no registered handlers at all.
        UnknownNodeVersion
            When *version* is given but no registered version is <= *version*.
        """
        type_versions = self._handlers.get(type_name)
        if not type_versions:
            raise UnknownNodeType(type_name)

        if version is None:
            # Return the explicitly set default, or the highest registered version.
            default_ver = self._explicit_defaults.get(type_name, max(type_versions))
            return type_versions[default_ver]

        # Exact match fast path.
        if version in type_versions:
            return type_versions[version]

        # Nearest lower version fallback.
        candidates = sorted(v for v in type_versions if v <= version)
        if not candidates:
            raise UnknownNodeVersion(
                f"No handler for {type_name!r} at version <= {version}; "
                f"registered: {sorted(type_versions)}"
            )
        used_version = candidates[-1]
        _LOG.warning(
            "node_version_fallback: type=%r requested=%s using=%s",
            type_name,
            version,
            used_version,
        )
        if self._fallback_listener is not None:
            try:
                self._fallback_listener(type_name, version, used_version)
            except Exception:  # noqa: BLE001
                _LOG.debug("node_version_fallback listener raised", exc_info=True)
        return type_versions[used_version]

    # ------------------------------------------------------------------
    # Introspection
    # ------------------------------------------------------------------

    def latest_version(self, type_name: str) -> float:
        """Return the highest registered version number for *type_name*.

        Raises ``UnknownNodeType`` if the type has no handlers.
        """
        type_versions = self._handlers.get(type_name)
        if not type_versions:
            raise UnknownNodeType(type_name)
        return max(type_versions)

    def has_type(self, type_name: str) -> bool:
        """Return ``True`` if *type_name* has at least one registered handler."""
        return bool(self._handlers.get(type_name))

    def registered_versions(self, type_name: str) -> list[float]:
        """Return sorted list of registered versions for *type_name*."""
        type_versions = self._handlers.get(type_name)
        if not type_versions:
            raise UnknownNodeType(type_name)
        return sorted(type_versions)

    def all_types(self) -> list[str]:
        """Return sorted list of all registered type names."""
        return sorted(self._handlers)


# ---------------------------------------------------------------------------
# Module-level default registry populated with all built-in node types at v1.
# The sentinel handler ``_builtin_v1`` signals "use the runner's built-in
# dispatch logic".  External callers that only need version resolution (e.g.
# the runner's main loop) can check whether the resolved handler IS the
# sentinel; if so, fall through to existing code.
# ---------------------------------------------------------------------------

def _builtin_v1(*_args: Any, **_kwargs: Any) -> None:  # noqa: ANN001
    """Sentinel handler indicating use of the runner's built-in dispatch."""


# All node types known to the runner as of schema v1.13 (F47 baseline).
_BUILTIN_V1_TYPES: tuple[str, ...] = (
    "start",
    "exit",
    "task",
    "graph_ref",
    "fork",
    "merge",
    "llm_agent",
    "agent",
    "ai_route",
    "mcp_tool",
    "trigger_webhook",
    "trigger_schedule",
    "trigger_error",
    "comment",
    "group",
    # Extended types present in the runner.
    "http_request",
    "rag_query",
    "rag_index",
    "python_code",
    "set_variable",
    "delay",
    "debounce",
    "wait_for",
    "prompt_concat",
    "api_call",
)

_BUILTIN_SENTINEL = _builtin_v1

_default_registry: NodeRegistry | None = None


def get_default_registry() -> NodeRegistry:
    """Return the module-level default registry, initialised on first call."""
    global _default_registry
    if _default_registry is None:
        _default_registry = NodeRegistry()
        for _t in _BUILTIN_V1_TYPES:
            _default_registry.register(_t, 1, _BUILTIN_SENTINEL, default=True)
    return _default_registry


def reset_default_registry() -> None:
    """Reset the default registry (useful in tests)."""
    global _default_registry
    _default_registry = None
