# Copyright GraphCaster. All Rights Reserved.

# =============================================================================
# Plugin trust & permission model — threat model
# =============================================================================
#
# Permissions are DECLARED by the plugin (in its manifest) and ENFORCED by the
# host only at *gate-call points* (see :class:`PermissionGate` below). That is,
# the host hands the plugin a :class:`PermissionGate` and a well-behaved plugin
# calls ``gate.require("filesystem.read")`` before doing a filesystem read; if
# the manifest did not declare ``storage``, the gate raises
# :class:`PermissionDenied`.
#
# This is best-effort defense-in-depth, NOT a sandbox:
#
#   * A malicious plugin can bypass the gate entirely by importing ``os`` /
#     ``socket`` / ``subprocess`` / ``requests`` / etc. directly. Python provides
#     no in-process isolation primitive that would prevent this.
#   * Until we add an out-of-process sandbox (Docker / Firecracker / nsjail),
#     installing a plugin from an entry point is equivalent to installing
#     arbitrary code on the host.
#
# What the gate *does* buy us:
#
#   * A clear contract between host and plugin authors. Honest plugins fail
#     fast when their manifest is wrong.
#   * Auditability: every gate call is a documentable trust boundary.
#   * A migration target: once a real sandbox lands, the same gate API can be
#     proxied across the sandbox boundary so we don't have to rewrite plugins.
#
# The trust store (`.graphcaster/plugins-trust.json`) is an *administrative*
# layer above the gate: it records which entry-point packages the workspace
# owner has reviewed. An untrusted plugin still loads (with a loud WARNING)
# unless ``GC_PLUGINS_STRICT_TRUST=1`` is set.
# =============================================================================

"""Trust file management and permission checking for plugins (F92)."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import TYPE_CHECKING, Any, Iterable

if TYPE_CHECKING:
    from graph_caster.plugin.manifest import PluginManifest

_DEFAULT_TRUST_PATH = Path.home() / ".graphcaster" / "plugin-trust.json"

# Workspace-scoped trust store: relative to the workspace root passed by the
# host. Used by PluginLoader's untrusted-load warning path.
WORKSPACE_TRUST_RELPATH = Path(".graphcaster") / "plugins-trust.json"

KNOWN_PERMISSIONS = frozenset({"storage", "network", "subprocess", "secrets", "model_calls"})

# Mapping from fine-grained gate names (callers use these strings) to the
# coarse permission flags declared on the manifest. Multiple gate names can map
# to the same flag (e.g. "filesystem.read" and "filesystem.write" both need
# the ``storage`` flag); this lets the gate API evolve without breaking the
# manifest schema.
_GATE_TO_PERMISSION: dict[str, str] = {
    "filesystem.read": "storage",
    "filesystem.write": "storage",
    "storage": "storage",
    "network": "network",
    "network.http": "network",
    "network.socket": "network",
    "subprocess": "subprocess",
    "secrets": "secrets",
    "secrets.read": "secrets",
    "model_calls": "model_calls",
    "llm": "model_calls",
}


class PluginNotTrustedError(RuntimeError):
    """Raised when strict-trust mode refuses to load an untrusted plugin."""


class PermissionDenied(RuntimeError):
    """Raised by :class:`PermissionGate.require` when the plugin lacks a permission."""


class PermissionGate:
    """Runtime check object handed to plugin entry points.

    Plugin code is expected to call :meth:`require` (or :meth:`check`) before
    performing a privileged operation. The gate consults the plugin's declared
    manifest permissions; if the gate name does not map to a declared
    permission, :class:`PermissionDenied` is raised.

    The gate is *opt-in* for plugin authors today — existing plugins that never
    touch the gate continue to work. New SDK code paths (and future built-in
    helpers like ``gate.fs.read()``) should consult the gate.
    """

    __slots__ = ("_plugin_name", "_granted", "_audit")

    def __init__(
        self,
        plugin_name: str,
        granted: Iterable[str],
        *,
        audit: list[tuple[str, bool]] | None = None,
    ) -> None:
        self._plugin_name = plugin_name
        self._granted: frozenset[str] = frozenset(granted)
        # Optional audit log of (gate_name, allowed) tuples. Useful for tests
        # and for the host to render a permissions-usage report.
        self._audit = audit

    @property
    def plugin_name(self) -> str:
        return self._plugin_name

    @property
    def granted(self) -> frozenset[str]:
        return self._granted

    def _resolve(self, gate_name: str) -> str:
        if gate_name in _GATE_TO_PERMISSION:
            return _GATE_TO_PERMISSION[gate_name]
        # Allow callers to pass the bare permission flag too.
        if gate_name in KNOWN_PERMISSIONS:
            return gate_name
        raise PermissionDenied(
            f"Plugin {self._plugin_name!r}: unknown permission gate {gate_name!r}. "
            f"Known: {sorted(set(_GATE_TO_PERMISSION) | KNOWN_PERMISSIONS)}"
        )

    def check(self, gate_name: str) -> bool:
        """Return True if the plugin has the permission, False otherwise. Never raises for known gates."""
        try:
            permission = self._resolve(gate_name)
        except PermissionDenied:
            allowed = False
        else:
            allowed = permission in self._granted
        if self._audit is not None:
            self._audit.append((gate_name, allowed))
        return allowed

    def require(self, gate_name: str) -> None:
        """Raise :class:`PermissionDenied` if the permission is not granted."""
        permission = self._resolve(gate_name)
        allowed = permission in self._granted
        if self._audit is not None:
            self._audit.append((gate_name, allowed))
        if not allowed:
            raise PermissionDenied(
                f"Plugin {self._plugin_name!r} attempted {gate_name!r} but did not declare "
                f"{permission!r} in its manifest permissions."
            )


def make_gate_for_manifest(manifest: "PluginManifest") -> PermissionGate:
    """Construct a :class:`PermissionGate` from a loaded manifest's declared permissions."""
    return PermissionGate(manifest.name, manifest.permissions.granted_set())


def _load_trust(trust_path: Path) -> dict[str, Any]:
    if not trust_path.exists():
        return {}
    try:
        return json.loads(trust_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def _save_trust(data: dict[str, Any], trust_path: Path) -> None:
    trust_path.parent.mkdir(parents=True, exist_ok=True)
    trust_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _manifest_hash(name: str, version: str) -> str:
    return hashlib.sha256(f"{name}@{version}".encode()).hexdigest()[:16]


def load_trusted_permissions(
    plugin_name: str,
    plugin_version: str,
    *,
    trust_path: Path | None = None,
) -> frozenset[str] | None:
    """Return the trusted permission set for the plugin, or None if not trusted yet."""
    path = trust_path or _DEFAULT_TRUST_PATH
    data = _load_trust(path)
    entry = data.get(plugin_name)
    if not isinstance(entry, dict):
        return None
    expected_hash = _manifest_hash(plugin_name, plugin_version)
    if entry.get("hash") != expected_hash:
        return None
    perms = entry.get("permissions", [])
    if not isinstance(perms, list):
        return None
    return frozenset(str(p) for p in perms)


def write_trust(
    plugin_name: str,
    plugin_version: str,
    permissions: frozenset[str] | set[str],
    *,
    trust_path: Path | None = None,
) -> None:
    """Persist trust for a plugin, overwriting any prior entry."""
    path = trust_path or _DEFAULT_TRUST_PATH
    data = _load_trust(path)
    data[plugin_name] = {
        "hash": _manifest_hash(plugin_name, plugin_version),
        "version": plugin_version,
        "permissions": sorted(permissions),
    }
    _save_trust(data, path)


def revoke_trust(plugin_name: str, *, trust_path: Path | None = None) -> None:
    path = trust_path or _DEFAULT_TRUST_PATH
    data = _load_trust(path)
    data.pop(plugin_name, None)
    _save_trust(data, path)


def check_permissions(
    plugin_name: str,
    plugin_version: str,
    required: frozenset[str],
    *,
    trust_path: Path | None = None,
) -> None:
    """Raise PermissionError if required permissions are not all trusted.

    Callers that want to auto-trust plugins in non-interactive mode should call
    write_trust() first, then check_permissions().
    """
    trusted = load_trusted_permissions(plugin_name, plugin_version, trust_path=trust_path)
    if trusted is None:
        if required:
            raise PermissionError(
                f"Plugin {plugin_name!r} is not trusted. "
                f"Run: python -m graph_caster plugin trust {plugin_name} --allow {','.join(sorted(required))}"
            )
        return
    missing = required - trusted
    if missing:
        raise PermissionError(
            f"Plugin {plugin_name!r} requires permissions not granted: {sorted(missing)}. "
            f"Run: python -m graph_caster plugin trust {plugin_name} --allow {','.join(sorted(required))}"
        )


# ---------------------------------------------------------------------------
# Workspace-scoped plugin trust store (P0 plugin trust model).
#
# Format: { "<package_name>": {"trusted_at": "<ISO-8601>", "manifest_sha256": "<hex>"} }
#
# This is separate from the per-user permission grant file above so existing
# tests and the older `--allow` flow keep working unchanged.
# ---------------------------------------------------------------------------

def workspace_trust_path(workspace_root: Path | None) -> Path | None:
    """Return the workspace-scoped trust file path, or None if no workspace given."""
    if workspace_root is None:
        return None
    return Path(workspace_root) / WORKSPACE_TRUST_RELPATH


def load_workspace_trust(trust_path: Path) -> dict[str, dict[str, Any]]:
    """Load the workspace plugin-trust JSON map. Returns {} if missing/corrupt."""
    if not trust_path.exists():
        return {}
    try:
        raw = json.loads(trust_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    if not isinstance(raw, dict):
        return {}
    # Coerce: only keep entries that are dicts. Anything else is treated as
    # absent (this preserves backwards-compat with hand-edited files).
    return {k: v for k, v in raw.items() if isinstance(v, dict)}


def save_workspace_trust(trust_path: Path, data: dict[str, dict[str, Any]]) -> None:
    trust_path.parent.mkdir(parents=True, exist_ok=True)
    trust_path.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")


def is_plugin_trusted(
    plugin_name: str,
    manifest_sha256: str,
    *,
    trust_path: Path,
) -> bool:
    """Return True if the plugin is recorded in the workspace trust store and the hash matches."""
    data = load_workspace_trust(trust_path)
    entry = data.get(plugin_name)
    if not isinstance(entry, dict):
        return False
    return entry.get("manifest_sha256") == manifest_sha256


def record_plugin_trust(
    plugin_name: str,
    manifest_sha256: str,
    *,
    trust_path: Path,
    trusted_at: str | None = None,
) -> None:
    """Add or overwrite a workspace trust entry for the plugin."""
    from datetime import datetime, timezone

    data = load_workspace_trust(trust_path)
    data[plugin_name] = {
        "trusted_at": trusted_at or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "manifest_sha256": manifest_sha256,
    }
    save_workspace_trust(trust_path, data)


def revoke_plugin_trust(plugin_name: str, *, trust_path: Path) -> bool:
    """Remove the trust entry for ``plugin_name``. Returns True if anything was removed."""
    data = load_workspace_trust(trust_path)
    if plugin_name not in data:
        return False
    del data[plugin_name]
    save_workspace_trust(trust_path, data)
    return True


def list_plugin_trust(trust_path: Path) -> list[dict[str, Any]]:
    """Return a list of trust entries: [{"name": ..., "trusted_at": ..., "manifest_sha256": ...}, ...]."""
    data = load_workspace_trust(trust_path)
    out: list[dict[str, Any]] = []
    for name, entry in sorted(data.items()):
        if not isinstance(entry, dict):
            continue
        out.append({
            "name": name,
            "trusted_at": entry.get("trusted_at"),
            "manifest_sha256": entry.get("manifest_sha256"),
        })
    return out
