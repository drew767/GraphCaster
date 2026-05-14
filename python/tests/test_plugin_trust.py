# Copyright GraphCaster. All Rights Reserved.

"""Tests for P0 plugin trust model: workspace trust store, warnings, strict mode, PermissionGate."""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from graph_caster.plugin import (
    PermissionDenied,
    PermissionGate,
    PluginNotTrustedError,
    list_trusted_plugins,
    trust_plugin,
    untrust_plugin,
)
from graph_caster.plugin.loader import PluginLoader
from graph_caster.plugin.manifest import (
    ManifestValidationError,
    PluginManifest,
    PluginPermissions,
    declare,
)
from graph_caster.plugin.permissions import (
    WORKSPACE_TRUST_RELPATH,
    PermissionGate as _PermissionGate,
    is_plugin_trusted,
    make_gate_for_manifest,
    record_plugin_trust,
    workspace_trust_path,
)
from graph_caster.plugin.registry import PluginRegistry


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class _RecordingSink:
    """Stand-in for a RunEventSink that records emitted events for assertion."""

    def __init__(self) -> None:
        self.events: list[dict] = []

    def emit(self, event: dict) -> None:
        self.events.append(event)


def _entry_point_manifest(name: str = "evilplugin", *, permissions: dict | None = None) -> PluginManifest:
    return declare(name=name, version="0.1.0", permissions=permissions or {})


def _patched_entry_points(fake_ep_name: str, manifest: PluginManifest):
    fake_ep = MagicMock()
    fake_ep.name = fake_ep_name
    fake_ep.load.return_value = manifest
    return patch("importlib.metadata.entry_points", return_value=[fake_ep])


def _legacy_trust_file(tmp_path: Path, plugin_name: str, version: str, perms: list[str]) -> Path:
    """Write the legacy per-user permissions trust file the loader still consults."""
    from graph_caster.plugin.permissions import write_trust
    p = tmp_path / "legacy-trust.json"
    write_trust(plugin_name, version, frozenset(perms), trust_path=p)
    return p


# ---------------------------------------------------------------------------
# Manifest schema strictness + sha256
# ---------------------------------------------------------------------------

class TestManifestStrictAndHash:
    def test_sha256_is_deterministic(self) -> None:
        m1 = declare(name="p", version="1.0", permissions={"network": True})
        m2 = declare(name="p", version="1.0", permissions={"network": True})
        assert m1.sha256() == m2.sha256()
        assert len(m1.sha256()) == 64

    def test_sha256_changes_with_permissions(self) -> None:
        m1 = declare(name="p", version="1.0", permissions={"network": False})
        m2 = declare(name="p", version="1.0", permissions={"network": True})
        assert m1.sha256() != m2.sha256()

    def test_from_dict_strict_rejects_unknown_top_level_keys(self) -> None:
        with pytest.raises(ManifestValidationError):
            PluginManifest.from_dict_strict(
                {"name": "p", "version": "1.0", "secret_backdoor": True}
            )

    def test_from_dict_strict_rejects_missing_required(self) -> None:
        with pytest.raises(ManifestValidationError):
            PluginManifest.from_dict_strict({"version": "1.0"})

    def test_from_dict_strict_rejects_unknown_permission_keys(self) -> None:
        with pytest.raises(ManifestValidationError):
            PluginManifest.from_dict_strict(
                {"name": "p", "version": "1.0", "permissions": {"network": True, "kernel": True}}
            )

    def test_from_dict_strict_accepts_valid(self) -> None:
        m = PluginManifest.from_dict_strict(
            {"name": "p", "version": "1.0", "permissions": {"network": True}}
        )
        assert m.name == "p"
        assert m.permissions.network is True


# ---------------------------------------------------------------------------
# Untrusted entry-point plugin emits warning + run event
# ---------------------------------------------------------------------------

class TestUntrustedWarning:
    def test_untrusted_entry_point_load_warns_and_emits_event(
        self, tmp_path: Path, caplog: pytest.LogCaptureFixture
    ) -> None:
        manifest = _entry_point_manifest("evilplugin", permissions={"network": True})
        sink = _RecordingSink()
        registry = PluginRegistry()
        legacy = _legacy_trust_file(tmp_path, "evilplugin", "0.1.0", ["network"])

        with _patched_entry_points("evilplugin", manifest):
            loader = PluginLoader(
                search_dirs=[tmp_path],
                trust_path=legacy,
                plugin_registry=registry,
                workspace_root=tmp_path,
                run_event_sink=sink,
                strict_trust=False,
            )
            with caplog.at_level(logging.WARNING, logger="graph_caster.plugin.loader"):
                m = asyncio.run(loader.load("evilplugin"))

        assert m.name == "evilplugin"
        # Warning log message mentions the plugin name and declared permissions.
        warned = [r for r in caplog.records if "Untrusted plugin loaded" in r.getMessage()]
        assert warned, f"expected Untrusted plugin loaded warning, got: {[r.getMessage() for r in caplog.records]}"
        assert "evilplugin" in warned[0].getMessage()
        # Run-event sink received the structured event.
        assert any(e.get("type") == "plugin.untrusted_loaded" for e in sink.events)
        ev = next(e for e in sink.events if e.get("type") == "plugin.untrusted_loaded")
        assert ev["plugin"] == "evilplugin"
        assert ev["declared_permissions"] == ["network"]
        assert ev["manifest_sha256"]

    def test_local_search_dir_plugin_does_not_warn(
        self, tmp_path: Path, caplog: pytest.LogCaptureFixture
    ) -> None:
        # Local plugins are not subject to workspace trust by design.
        pkg = tmp_path / "localpkg"
        pkg.mkdir()
        (pkg / "__init__.py").write_text(
            "from graph_caster.plugin import declare\n"
            "manifest = declare(name='localpkg', version='0.1.0')\n",
            encoding="utf-8",
        )
        legacy = _legacy_trust_file(tmp_path, "localpkg", "0.1.0", [])
        sink = _RecordingSink()
        loader = PluginLoader(
            search_dirs=[tmp_path],
            trust_path=legacy,
            plugin_registry=PluginRegistry(),
            workspace_root=tmp_path,
            run_event_sink=sink,
            strict_trust=False,
        )
        with caplog.at_level(logging.WARNING, logger="graph_caster.plugin.loader"):
            asyncio.run(loader.load("localpkg"))
        assert not any("Untrusted plugin loaded" in r.getMessage() for r in caplog.records)
        assert not any(e.get("type") == "plugin.untrusted_loaded" for e in sink.events)


# ---------------------------------------------------------------------------
# Strict trust mode refuses to load
# ---------------------------------------------------------------------------

class TestStrictTrustMode:
    def test_strict_mode_refuses_untrusted_entry_point(self, tmp_path: Path) -> None:
        manifest = _entry_point_manifest("badplugin")
        legacy = _legacy_trust_file(tmp_path, "badplugin", "0.1.0", [])
        with _patched_entry_points("badplugin", manifest):
            loader = PluginLoader(
                search_dirs=[tmp_path],
                trust_path=legacy,
                plugin_registry=PluginRegistry(),
                workspace_root=tmp_path,
                strict_trust=True,
            )
            with pytest.raises(PluginNotTrustedError):
                asyncio.run(loader.load("badplugin"))

    def test_strict_mode_via_env_var(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        manifest = _entry_point_manifest("envplugin")
        legacy = _legacy_trust_file(tmp_path, "envplugin", "0.1.0", [])
        monkeypatch.setenv("GC_PLUGINS_STRICT_TRUST", "1")
        with _patched_entry_points("envplugin", manifest):
            loader = PluginLoader(
                search_dirs=[tmp_path],
                trust_path=legacy,
                plugin_registry=PluginRegistry(),
                workspace_root=tmp_path,
            )
            with pytest.raises(PluginNotTrustedError):
                asyncio.run(loader.load("envplugin"))

    def test_strict_mode_allows_trusted_plugin(self, tmp_path: Path) -> None:
        manifest = _entry_point_manifest("goodplugin")
        legacy = _legacy_trust_file(tmp_path, "goodplugin", "0.1.0", [])
        ws_trust = workspace_trust_path(tmp_path)
        assert ws_trust is not None
        record_plugin_trust("goodplugin", manifest.sha256(), trust_path=ws_trust)
        with _patched_entry_points("goodplugin", manifest):
            loader = PluginLoader(
                search_dirs=[tmp_path],
                trust_path=legacy,
                plugin_registry=PluginRegistry(),
                workspace_root=tmp_path,
                strict_trust=True,
            )
            m = asyncio.run(loader.load("goodplugin"))
            assert m.name == "goodplugin"


# ---------------------------------------------------------------------------
# trust_plugin / list / untrust
# ---------------------------------------------------------------------------

class TestTrustHelpers:
    def test_trust_plugin_persists_to_json(self, tmp_path: Path) -> None:
        manifest = _entry_point_manifest("freshplugin")
        ws_trust = tmp_path / WORKSPACE_TRUST_RELPATH
        trust_plugin("freshplugin", manifest=manifest, trust_path=ws_trust)
        assert ws_trust.exists()
        data = json.loads(ws_trust.read_text(encoding="utf-8"))
        assert "freshplugin" in data
        assert data["freshplugin"]["manifest_sha256"] == manifest.sha256()
        assert data["freshplugin"]["trusted_at"]

    def test_trusted_plugin_second_load_silent(
        self, tmp_path: Path, caplog: pytest.LogCaptureFixture
    ) -> None:
        manifest = _entry_point_manifest("silentplugin")
        legacy = _legacy_trust_file(tmp_path, "silentplugin", "0.1.0", [])
        ws_trust = workspace_trust_path(tmp_path)
        assert ws_trust is not None
        # Trust the plugin first.
        trust_plugin("silentplugin", manifest=manifest, trust_path=ws_trust)
        sink = _RecordingSink()
        with _patched_entry_points("silentplugin", manifest):
            loader = PluginLoader(
                search_dirs=[tmp_path],
                trust_path=legacy,
                plugin_registry=PluginRegistry(),
                workspace_root=tmp_path,
                run_event_sink=sink,
            )
            with caplog.at_level(logging.WARNING, logger="graph_caster.plugin.loader"):
                asyncio.run(loader.load("silentplugin"))
        assert not any("Untrusted plugin loaded" in r.getMessage() for r in caplog.records)
        assert not any(e.get("type") == "plugin.untrusted_loaded" for e in sink.events)

    def test_list_and_untrust(self, tmp_path: Path) -> None:
        m1 = _entry_point_manifest("alpha")
        m2 = _entry_point_manifest("beta")
        ws_trust = tmp_path / WORKSPACE_TRUST_RELPATH
        trust_plugin("alpha", manifest=m1, trust_path=ws_trust)
        trust_plugin("beta", manifest=m2, trust_path=ws_trust)
        listed = list_trusted_plugins(trust_path=ws_trust)
        names = {e["name"] for e in listed}
        assert names == {"alpha", "beta"}
        removed = untrust_plugin("alpha", trust_path=ws_trust)
        assert removed is True
        listed_after = list_trusted_plugins(trust_path=ws_trust)
        assert {e["name"] for e in listed_after} == {"beta"}

    def test_untrust_missing_returns_false(self, tmp_path: Path) -> None:
        ws_trust = tmp_path / WORKSPACE_TRUST_RELPATH
        assert untrust_plugin("nothing-here", trust_path=ws_trust) is False


# ---------------------------------------------------------------------------
# Manifest hash mismatch re-warns
# ---------------------------------------------------------------------------

class TestManifestHashMismatch:
    def test_hash_change_after_trust_rewarns(
        self, tmp_path: Path, caplog: pytest.LogCaptureFixture
    ) -> None:
        original = declare(name="mutator", version="0.1.0", permissions={"network": False})
        # Legacy permissions store grants network so the per-user check passes
        # regardless; we are isolating the workspace trust-store behaviour.
        legacy = _legacy_trust_file(tmp_path, "mutator", "0.1.0", ["network"])
        ws_trust = workspace_trust_path(tmp_path)
        assert ws_trust is not None
        trust_plugin("mutator", manifest=original, trust_path=ws_trust)
        # Plugin author publishes a "new version" with a different permission
        # surface — its sha256 changes, so the recorded hash no longer matches.
        mutated = declare(name="mutator", version="0.1.0", permissions={"network": True})
        assert mutated.sha256() != original.sha256()
        assert not is_plugin_trusted("mutator", mutated.sha256(), trust_path=ws_trust)

        sink = _RecordingSink()
        with _patched_entry_points("mutator", mutated):
            loader = PluginLoader(
                search_dirs=[tmp_path],
                trust_path=legacy,
                plugin_registry=PluginRegistry(),
                workspace_root=tmp_path,
                run_event_sink=sink,
                strict_trust=False,
            )
            with caplog.at_level(logging.WARNING, logger="graph_caster.plugin.loader"):
                asyncio.run(loader.load("mutator"))
        assert any("Untrusted plugin loaded" in r.getMessage() for r in caplog.records)
        assert any(e.get("type") == "plugin.untrusted_loaded" for e in sink.events)


# ---------------------------------------------------------------------------
# PermissionGate runtime enforcement
# ---------------------------------------------------------------------------

class TestPermissionGate:
    def test_require_denies_missing_permission(self) -> None:
        gate = PermissionGate("p", granted=frozenset())
        with pytest.raises(PermissionDenied):
            gate.require("network")

    def test_require_allows_granted(self) -> None:
        gate = PermissionGate("p", granted=frozenset({"network"}))
        gate.require("network")  # no raise
        gate.require("network.http")  # alias also resolved
        gate.require("network.socket")

    def test_filesystem_gates_require_storage(self) -> None:
        gate = PermissionGate("p", granted=frozenset({"storage"}))
        gate.require("filesystem.read")
        gate.require("filesystem.write")

    def test_secrets_gate(self) -> None:
        gate = PermissionGate("p", granted=frozenset())
        with pytest.raises(PermissionDenied):
            gate.require("secrets")
        gate2 = PermissionGate("p", granted=frozenset({"secrets"}))
        gate2.require("secrets")
        gate2.require("secrets.read")

    def test_check_returns_bool(self) -> None:
        gate = PermissionGate("p", granted=frozenset({"network"}))
        assert gate.check("network") is True
        assert gate.check("storage") is False
        assert gate.check("not-a-real-gate") is False

    def test_unknown_gate_name_raises(self) -> None:
        gate = PermissionGate("p", granted=frozenset({"network"}))
        with pytest.raises(PermissionDenied):
            gate.require("hyperdrive.engage")

    def test_audit_log(self) -> None:
        audit: list[tuple[str, bool]] = []
        gate = PermissionGate("p", granted=frozenset({"network"}), audit=audit)
        gate.check("network")
        try:
            gate.require("secrets")
        except PermissionDenied:
            pass
        # Both calls recorded; second is False.
        assert ("network", True) in audit
        assert ("secrets", False) in audit

    def test_loader_constructs_gate_per_plugin(self, tmp_path: Path) -> None:
        manifest = declare(name="gateplugin", version="0.1.0", permissions={"network": True})
        legacy = _legacy_trust_file(tmp_path, "gateplugin", "0.1.0", ["network"])
        ws_trust = workspace_trust_path(tmp_path)
        assert ws_trust is not None
        trust_plugin("gateplugin", manifest=manifest, trust_path=ws_trust)
        with _patched_entry_points("gateplugin", manifest):
            loader = PluginLoader(
                search_dirs=[tmp_path],
                trust_path=legacy,
                plugin_registry=PluginRegistry(),
                workspace_root=tmp_path,
            )
            asyncio.run(loader.load("gateplugin"))
        gate = loader.get_gate("gateplugin")
        assert gate is not None
        assert isinstance(gate, _PermissionGate)
        gate.require("network")
        with pytest.raises(PermissionDenied):
            gate.require("secrets")

    def test_make_gate_for_manifest(self) -> None:
        manifest = declare(name="x", version="1", permissions={"secrets": True})
        gate = make_gate_for_manifest(manifest)
        gate.require("secrets")
        with pytest.raises(PermissionDenied):
            gate.require("network")
