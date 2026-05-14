# Copyright GraphCaster. All Rights Reserved.

"""GraphCaster Plugin API (F92) — pip-installable extensions."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from graph_caster.plugin.loader import PluginLoader
from graph_caster.plugin.manifest import (
    ManifestValidationError,
    PluginManifest,
    PluginPermissions,
    declare,
)
from graph_caster.plugin.permissions import (
    PermissionDenied,
    PermissionGate,
    PluginNotTrustedError,
    list_plugin_trust,
    make_gate_for_manifest,
    record_plugin_trust,
    revoke_plugin_trust,
    workspace_trust_path,
)
from graph_caster.plugin.registry import PluginRegistry, get_plugin_registry


def _resolve_workspace_trust_path(workspace_root: Path | str | None) -> Path:
    """Resolve the workspace trust file path, defaulting to CWD if no root supplied."""
    root = Path(workspace_root) if workspace_root is not None else Path.cwd()
    path = workspace_trust_path(root)
    assert path is not None
    return path


def trust_plugin(
    name: str,
    *,
    manifest: PluginManifest | None = None,
    workspace_root: Path | str | None = None,
    trust_path: Path | None = None,
) -> dict[str, Any]:
    """Record workspace trust for a plugin and return the persisted entry.

    If ``manifest`` is provided, its SHA-256 is captured at trust time so
    future loads can detect tampering. Otherwise the entry is written with
    an empty hash and any later load will be treated as a hash-mismatch and
    re-warn.
    """
    path = trust_path or _resolve_workspace_trust_path(workspace_root)
    digest = manifest.sha256() if manifest is not None else ""
    record_plugin_trust(name, digest, trust_path=path)
    # Return the just-written entry for callers that want to display it.
    for entry in list_plugin_trust(path):
        if entry["name"] == name:
            return entry
    return {"name": name, "trusted_at": None, "manifest_sha256": digest}


def untrust_plugin(
    name: str,
    *,
    workspace_root: Path | str | None = None,
    trust_path: Path | None = None,
) -> bool:
    """Revoke workspace trust for a plugin. Returns True if anything was removed."""
    path = trust_path or _resolve_workspace_trust_path(workspace_root)
    return revoke_plugin_trust(name, trust_path=path)


def list_trusted_plugins(
    *,
    workspace_root: Path | str | None = None,
    trust_path: Path | None = None,
) -> list[dict[str, Any]]:
    """Return all plugins recorded in the workspace trust store."""
    path = trust_path or _resolve_workspace_trust_path(workspace_root)
    return list_plugin_trust(path)


__all__ = [
    "declare",
    "get_plugin_registry",
    "list_trusted_plugins",
    "make_gate_for_manifest",
    "ManifestValidationError",
    "PermissionDenied",
    "PermissionGate",
    "PluginLoader",
    "PluginManifest",
    "PluginNotTrustedError",
    "PluginPermissions",
    "PluginRegistry",
    "trust_plugin",
    "untrust_plugin",
]
