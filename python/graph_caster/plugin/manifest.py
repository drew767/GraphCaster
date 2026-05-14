# Copyright GraphCaster. All Rights Reserved.

"""Plugin manifest dataclasses and declare() helper (F92)."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


KNOWN_PERMISSION_KEYS = frozenset({"storage", "network", "subprocess", "secrets", "model_calls"})

# Required keys for a manifest dict (used by from_dict strict validation).
_REQUIRED_MANIFEST_KEYS = frozenset({"name", "version"})

# Allowed keys at the top level of a manifest dict; anything else is rejected.
_ALLOWED_MANIFEST_KEYS = frozenset({
    "name",
    "version",
    "description",
    "author",
    "homepage",
    "permissions",
    "nodes",
    "tools",
    "model_providers",
    "triggers",
    "datasources",
    "locales_dir",
})


class ManifestValidationError(ValueError):
    """Raised when a manifest fails schema validation (missing required or unknown fields)."""


@dataclass
class PluginPermissions:
    storage: bool = False
    network: bool = False
    subprocess: bool = False
    secrets: bool = False
    model_calls: bool = False

    def to_dict(self) -> dict[str, bool]:
        return {
            "storage": self.storage,
            "network": self.network,
            "subprocess": self.subprocess,
            "secrets": self.secrets,
            "model_calls": self.model_calls,
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> PluginPermissions:
        return cls(
            storage=bool(d.get("storage", False)),
            network=bool(d.get("network", False)),
            subprocess=bool(d.get("subprocess", False)),
            secrets=bool(d.get("secrets", False)),
            model_calls=bool(d.get("model_calls", False)),
        )

    @classmethod
    def from_dict_strict(cls, d: dict[str, Any]) -> PluginPermissions:
        """Like from_dict but rejects unknown permission keys.

        Used by manifest strict-schema path so that malicious or typo'd permission
        keys cannot silently slip past validation.
        """
        if not isinstance(d, dict):
            raise ManifestValidationError(f"permissions must be a dict, got {type(d).__name__}")
        unknown = set(d.keys()) - KNOWN_PERMISSION_KEYS
        if unknown:
            raise ManifestValidationError(
                f"permissions block has unknown keys: {sorted(unknown)} "
                f"(known: {sorted(KNOWN_PERMISSION_KEYS)})"
            )
        return cls.from_dict(d)

    def granted_set(self) -> frozenset[str]:
        return frozenset(k for k, v in self.to_dict().items() if v)

    @classmethod
    def from_set(cls, names: set[str] | frozenset[str]) -> PluginPermissions:
        return cls(
            storage="storage" in names,
            network="network" in names,
            subprocess="subprocess" in names,
            secrets="secrets" in names,
            model_calls="model_calls" in names,
        )


@dataclass
class PluginManifest:
    name: str
    version: str
    description: str = ""
    author: str = ""
    homepage: str = ""
    permissions: PluginPermissions = field(default_factory=lambda: PluginPermissions())
    nodes: list[type] = field(default_factory=list)
    tools: list[Any] = field(default_factory=list)
    model_providers: list[Any] = field(default_factory=list)
    triggers: list[type] = field(default_factory=list)
    datasources: list[Any] = field(default_factory=list)
    locales_dir: Path | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "version": self.version,
            "description": self.description,
            "author": self.author,
            "homepage": self.homepage,
            "permissions": self.permissions.to_dict(),
            "nodes": [getattr(c, "__name__", str(c)) for c in self.nodes],
            "tools": [getattr(t, "name", str(t)) for t in self.tools],
            "model_providers": [getattr(p, "name", str(p)) for p in self.model_providers],
            "triggers": [getattr(c, "__name__", str(c)) for c in self.triggers],
            "datasources": [getattr(d, "__class__", type(d)).__name__ for d in self.datasources],
            "locales_dir": str(self.locales_dir) if self.locales_dir is not None else None,
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=2)

    def sha256(self) -> str:
        """Stable SHA-256 hex digest of this manifest's content.

        The hash covers fields a host would notice if a previously-trusted plugin
        was modified on disk: identity, declared permissions, and the names of
        contributed nodes/tools/providers/triggers/datasources. Sorted keys make
        the digest insensitive to dict ordering.
        """
        canon = json.dumps(self.to_dict(), ensure_ascii=False, sort_keys=True)
        return hashlib.sha256(canon.encode("utf-8")).hexdigest()

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> PluginManifest:
        perms_raw = d.get("permissions", {})
        perms = PluginPermissions.from_dict(perms_raw if isinstance(perms_raw, dict) else {})
        locales = Path(d["locales_dir"]) if d.get("locales_dir") else None
        return cls(
            name=d["name"],
            version=d["version"],
            description=d.get("description", ""),
            author=d.get("author", ""),
            homepage=d.get("homepage", ""),
            permissions=perms,
            nodes=[],
            tools=[],
            model_providers=[],
            triggers=[],
            datasources=[],
            locales_dir=locales,
        )

    @classmethod
    def from_dict_strict(cls, d: dict[str, Any]) -> PluginManifest:
        """Validate a manifest dict against the schema, then construct.

        Enforces:
          * required top-level keys (``name``, ``version``)
          * ``additionalProperties: false`` — no unknown top-level keys
          * known permission keys only
          * ``name`` and ``version`` are non-empty strings

        Raises :class:`ManifestValidationError` on any failure.
        """
        if not isinstance(d, dict):
            raise ManifestValidationError(f"manifest must be a dict, got {type(d).__name__}")
        missing = _REQUIRED_MANIFEST_KEYS - set(d.keys())
        if missing:
            raise ManifestValidationError(f"manifest missing required keys: {sorted(missing)}")
        unknown = set(d.keys()) - _ALLOWED_MANIFEST_KEYS
        if unknown:
            raise ManifestValidationError(
                f"manifest has unknown top-level keys: {sorted(unknown)} "
                f"(allowed: {sorted(_ALLOWED_MANIFEST_KEYS)})"
            )
        name = d["name"]
        version = d["version"]
        if not isinstance(name, str) or not name.strip():
            raise ManifestValidationError("manifest 'name' must be a non-empty string")
        if not isinstance(version, str) or not version.strip():
            raise ManifestValidationError("manifest 'version' must be a non-empty string")
        perms_raw = d.get("permissions", {})
        perms = PluginPermissions.from_dict_strict(perms_raw if isinstance(perms_raw, dict) else {})
        locales = Path(d["locales_dir"]) if d.get("locales_dir") else None
        return cls(
            name=name,
            version=version,
            description=d.get("description", ""),
            author=d.get("author", ""),
            homepage=d.get("homepage", ""),
            permissions=perms,
            nodes=[],
            tools=[],
            model_providers=[],
            triggers=[],
            datasources=[],
            locales_dir=locales,
        )


def declare(
    name: str,
    version: str,
    *,
    description: str = "",
    author: str = "",
    homepage: str = "",
    permissions: PluginPermissions | dict[str, bool] | None = None,
    nodes: list[type] | None = None,
    tools: list[Any] | None = None,
    model_providers: list[Any] | None = None,
    triggers: list[type] | None = None,
    datasources: list[Any] | None = None,
    locales_dir: Path | str | None = None,
) -> PluginManifest:
    """Helper for plugin __init__.py: returns a PluginManifest."""
    if permissions is None:
        perms = PluginPermissions()
    elif isinstance(permissions, dict):
        perms = PluginPermissions.from_dict(permissions)
    else:
        perms = permissions

    ld: Path | None = None
    if locales_dir is not None:
        ld = Path(locales_dir)

    return PluginManifest(
        name=name,
        version=version,
        description=description,
        author=author,
        homepage=homepage,
        permissions=perms,
        nodes=list(nodes or []),
        tools=list(tools or []),
        model_providers=list(model_providers or []),
        triggers=list(triggers or []),
        datasources=list(datasources or []),
        locales_dir=ld,
    )
