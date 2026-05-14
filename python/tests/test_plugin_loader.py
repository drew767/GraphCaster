# Copyright GraphCaster. All Rights Reserved.

"""Tests for PluginLoader (F92)."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from graph_caster.node_api import GraphCasterNode, Input, Output, all_registered, register_class
from graph_caster.node_api.registry import _REGISTRY
from graph_caster.plugin.loader import PluginLoader
from graph_caster.plugin.manifest import PluginManifest, PluginPermissions, declare
from graph_caster.plugin.permissions import write_trust
from graph_caster.plugin.registry import PluginRegistry


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_fake_plugin_dir(tmp_path: Path, plugin_name: str = "fake") -> Path:
    """Create a minimal fake plugin package in tmp_path."""
    pkg_dir = tmp_path / plugin_name
    pkg_dir.mkdir()

    node_file = pkg_dir / "fake_nodes.py"
    node_file.write_text(
        "from graph_caster.node_api import GraphCasterNode, Input, Output\n"
        "\n"
        "class FakeNode(GraphCasterNode):\n"
        "    type = 'fake_node'\n"
        "    version = 1.0\n"
        "    inputs = []\n"
        "    outputs = []\n"
        "    async def run(self, ctx, **kwargs):\n"
        "        return {}\n",
        encoding="utf-8",
    )

    init_file = pkg_dir / "__init__.py"
    init_file.write_text(
        "from graph_caster.plugin import declare\n"
        "from .fake_nodes import FakeNode\n"
        "\n"
        "manifest = declare(\n"
        '    name="fake",\n'
        '    version="1.0.0",\n'
        "    nodes=[FakeNode],\n"
        ")\n",
        encoding="utf-8",
    )
    return pkg_dir


def _make_trust_file(tmp_path: Path, plugin_name: str, version: str, perms: list[str]) -> Path:
    trust_path = tmp_path / "plugin-trust.json"
    write_trust(plugin_name, version, frozenset(perms), trust_path=trust_path)
    return trust_path


# ---------------------------------------------------------------------------
# Tests: basic load via search_dirs
# ---------------------------------------------------------------------------

class TestPluginLoaderLocalDiscovery:
    def test_discover_local_finds_package(self, tmp_path: Path) -> None:
        _make_fake_plugin_dir(tmp_path)
        loader = PluginLoader(search_dirs=[tmp_path])
        found = loader.discover_local()
        assert any(p.name == "fake" for p in found)

    def test_discover_local_empty_dir(self, tmp_path: Path) -> None:
        loader = PluginLoader(search_dirs=[tmp_path])
        assert loader.discover_local() == []

    def test_discover_local_nonexistent_dir(self, tmp_path: Path) -> None:
        loader = PluginLoader(search_dirs=[tmp_path / "nonexistent"])
        assert loader.discover_local() == []

    def test_load_registers_node_with_f95(self, tmp_path: Path) -> None:
        _make_fake_plugin_dir(tmp_path, "fakepkg")
        trust_path = _make_trust_file(tmp_path, "fake", "1.0.0", [])

        registry = PluginRegistry()
        loader = PluginLoader(
            search_dirs=[tmp_path],
            trust_path=trust_path,
            plugin_registry=registry,
        )
        manifest = asyncio.run(loader.load("fakepkg"))

        assert manifest.name == "fake"
        # FakeNode should be registered in the global node registry
        from graph_caster.node_api.registry import _REGISTRY
        assert ("fake_node", 1.0) in _REGISTRY

    def test_load_returns_manifest(self, tmp_path: Path) -> None:
        _make_fake_plugin_dir(tmp_path)
        trust_path = _make_trust_file(tmp_path, "fake", "1.0.0", [])
        registry = PluginRegistry()
        loader = PluginLoader(
            search_dirs=[tmp_path],
            trust_path=trust_path,
            plugin_registry=registry,
        )
        m = asyncio.run(loader.load("fake"))
        assert isinstance(m, PluginManifest)
        assert m.version == "1.0.0"

    def test_list_loaded_reflects_state(self, tmp_path: Path) -> None:
        _make_fake_plugin_dir(tmp_path)
        trust_path = _make_trust_file(tmp_path, "fake", "1.0.0", [])
        registry = PluginRegistry()
        loader = PluginLoader(
            search_dirs=[tmp_path],
            trust_path=trust_path,
            plugin_registry=registry,
        )
        assert loader.list_loaded() == []
        asyncio.run(loader.load("fake"))
        loaded = loader.list_loaded()
        assert len(loaded) == 1
        assert loaded[0].name == "fake"

    def test_load_twice_is_idempotent(self, tmp_path: Path) -> None:
        _make_fake_plugin_dir(tmp_path)
        trust_path = _make_trust_file(tmp_path, "fake", "1.0.0", [])
        registry = PluginRegistry()
        loader = PluginLoader(
            search_dirs=[tmp_path],
            trust_path=trust_path,
            plugin_registry=registry,
        )
        m1 = asyncio.run(loader.load("fake"))
        m2 = asyncio.run(loader.load("fake"))
        assert m1 is m2


# ---------------------------------------------------------------------------
# Tests: unload removes registrations
# ---------------------------------------------------------------------------

class TestPluginLoaderUnload:
    def test_unload_removes_node(self, tmp_path: Path) -> None:
        _make_fake_plugin_dir(tmp_path, "unpkg")
        trust_path = _make_trust_file(tmp_path, "fake", "1.0.0", [])
        registry = PluginRegistry()
        loader = PluginLoader(
            search_dirs=[tmp_path],
            trust_path=trust_path,
            plugin_registry=registry,
        )
        asyncio.run(loader.load("unpkg"))

        from graph_caster.node_api.registry import _REGISTRY
        assert ("fake_node", 1.0) in _REGISTRY

        asyncio.run(loader.unload("unpkg"))

        assert ("fake_node", 1.0) not in _REGISTRY
        assert loader.list_loaded() == []

    def test_unload_nonexistent_is_noop(self, tmp_path: Path) -> None:
        registry = PluginRegistry()
        loader = PluginLoader(search_dirs=[tmp_path], plugin_registry=registry)
        asyncio.run(loader.unload("doesnotexist"))  # should not raise


# ---------------------------------------------------------------------------
# Tests: permission checks
# ---------------------------------------------------------------------------

class TestPluginLoaderPermissions:
    def test_plugin_requiring_network_trusted(self, tmp_path: Path) -> None:
        pkg_dir = tmp_path / "netpkg"
        pkg_dir.mkdir()
        (pkg_dir / "fake_nodes.py").write_text(
            "from graph_caster.node_api import GraphCasterNode\n"
            "class NetNode(GraphCasterNode):\n"
            "    type = 'net_node'\n"
            "    version = 1.0\n"
            "    inputs = []\n"
            "    outputs = []\n"
            "    async def run(self, ctx, **kwargs): return {}\n",
            encoding="utf-8",
        )
        (pkg_dir / "__init__.py").write_text(
            "from graph_caster.plugin import declare\n"
            "from .fake_nodes import NetNode\n"
            "manifest = declare(\n"
            '    name="netpkg", version="1.0", permissions={"network": True}, nodes=[NetNode],\n'
            ")\n",
            encoding="utf-8",
        )
        trust_path = _make_trust_file(tmp_path, "netpkg", "1.0", ["network"])
        registry = PluginRegistry()
        loader = PluginLoader(
            search_dirs=[tmp_path],
            trust_path=trust_path,
            plugin_registry=registry,
        )
        m = asyncio.run(loader.load("netpkg"))
        assert m.permissions.network is True

    def test_plugin_requiring_network_not_trusted_raises(self, tmp_path: Path) -> None:
        pkg_dir = tmp_path / "netpkg2"
        pkg_dir.mkdir()
        (pkg_dir / "__init__.py").write_text(
            "from graph_caster.plugin import declare\n"
            "manifest = declare(\n"
            '    name="netpkg2", version="1.0", permissions={"network": True},\n'
            ")\n",
            encoding="utf-8",
        )
        # Trust file only grants 'storage', not 'network'
        trust_path = _make_trust_file(tmp_path, "netpkg2", "1.0", ["storage"])
        registry = PluginRegistry()
        loader = PluginLoader(
            search_dirs=[tmp_path],
            trust_path=trust_path,
            plugin_registry=registry,
        )
        with pytest.raises(PermissionError):
            asyncio.run(loader.load("netpkg2"))

    def test_untrusted_plugin_with_no_permissions_loads(self, tmp_path: Path) -> None:
        _make_fake_plugin_dir(tmp_path, "noperms")
        # Trust file exists with empty permissions for this plugin
        trust_path = _make_trust_file(tmp_path, "fake", "1.0.0", [])
        registry = PluginRegistry()
        loader = PluginLoader(
            search_dirs=[tmp_path],
            trust_path=trust_path,
            plugin_registry=registry,
        )
        m = asyncio.run(loader.load("noperms"))
        assert m is not None


# ---------------------------------------------------------------------------
# Tests: trust file write / read roundtrip
# ---------------------------------------------------------------------------

class TestTrustFileRoundtrip:
    def test_write_and_read_trust(self, tmp_path: Path) -> None:
        from graph_caster.plugin.permissions import load_trusted_permissions

        trust_path = tmp_path / "trust.json"
        write_trust("myplugin", "1.2.3", frozenset({"network", "storage"}), trust_path=trust_path)

        trusted = load_trusted_permissions("myplugin", "1.2.3", trust_path=trust_path)
        assert trusted == frozenset({"network", "storage"})

    def test_wrong_version_returns_none(self, tmp_path: Path) -> None:
        from graph_caster.plugin.permissions import load_trusted_permissions

        trust_path = tmp_path / "trust.json"
        write_trust("myplugin", "1.0", frozenset({"network"}), trust_path=trust_path)

        trusted = load_trusted_permissions("myplugin", "2.0", trust_path=trust_path)
        assert trusted is None

    def test_untrusted_plugin_returns_none(self, tmp_path: Path) -> None:
        from graph_caster.plugin.permissions import load_trusted_permissions

        trust_path = tmp_path / "trust.json"
        trusted = load_trusted_permissions("unknown", "1.0", trust_path=trust_path)
        assert trusted is None

    def test_revoke_trust(self, tmp_path: Path) -> None:
        from graph_caster.plugin.permissions import load_trusted_permissions, revoke_trust

        trust_path = tmp_path / "trust.json"
        write_trust("p", "1.0", frozenset({"network"}), trust_path=trust_path)
        revoke_trust("p", trust_path=trust_path)
        assert load_trusted_permissions("p", "1.0", trust_path=trust_path) is None


# ---------------------------------------------------------------------------
# Tests: auto_trust mode
# ---------------------------------------------------------------------------

class TestAutoTrust:
    def test_auto_trust_writes_trust_and_loads(self, tmp_path: Path) -> None:
        _make_fake_plugin_dir(tmp_path)
        trust_path = tmp_path / "trust.json"
        registry = PluginRegistry()
        loader = PluginLoader(
            search_dirs=[tmp_path],
            trust_path=trust_path,
            plugin_registry=registry,
            auto_trust=True,
        )
        m = asyncio.run(loader.load("fake"))
        assert m.name == "fake"
        # Trust file should have been written
        assert trust_path.exists()
        data = json.loads(trust_path.read_text(encoding="utf-8"))
        assert "fake" in data


# ---------------------------------------------------------------------------
# Tests: entry-point discovery (mocked)
# ---------------------------------------------------------------------------

class TestEntryPointDiscovery:
    def test_discover_entry_points_with_mock(self, tmp_path: Path) -> None:
        trust_path = _make_trust_file(tmp_path, "fake", "1.0.0", [])

        fake_ep = MagicMock()
        fake_ep.name = "eplugin"
        fake_ep.load.return_value = declare(name="fake", version="1.0.0")

        with patch("importlib.metadata.entry_points", return_value=[fake_ep]):
            loader = PluginLoader(
                search_dirs=[tmp_path],
                trust_path=trust_path,
            )
            names = loader.discover_entry_points()
            assert "eplugin" in names

    def test_load_via_entry_point(self, tmp_path: Path) -> None:
        trust_path = _make_trust_file(tmp_path, "fake", "1.0.0", [])
        registry = PluginRegistry()

        fake_manifest = declare(name="fake", version="1.0.0")
        fake_ep = MagicMock()
        fake_ep.name = "epkg"
        fake_ep.load.return_value = fake_manifest

        with patch("importlib.metadata.entry_points", return_value=[fake_ep]):
            loader = PluginLoader(
                search_dirs=[tmp_path],
                trust_path=trust_path,
                plugin_registry=registry,
            )
            m = asyncio.run(loader.load("epkg"))
            assert m.name == "fake"


# ---------------------------------------------------------------------------
# Tests: concurrent load of 3 plugins
# ---------------------------------------------------------------------------

class TestConcurrentLoad:
    def test_load_three_plugins_concurrently(self, tmp_path: Path) -> None:
        for i in range(3):
            pkg = tmp_path / f"plugin{i}"
            pkg.mkdir()
            (pkg / "__init__.py").write_text(
                "from graph_caster.plugin import declare\n"
                f"manifest = declare(name='plugin{i}', version='1.0')\n",
                encoding="utf-8",
            )
            write_trust(f"plugin{i}", "1.0", frozenset(), trust_path=tmp_path / "trust.json")

        registry = PluginRegistry()
        loader = PluginLoader(
            search_dirs=[tmp_path],
            trust_path=tmp_path / "trust.json",
            plugin_registry=registry,
        )

        async def load_all():
            results = await asyncio.gather(
                loader.load("plugin0"),
                loader.load("plugin1"),
                loader.load("plugin2"),
            )
            return results

        manifests = asyncio.run(load_all())
        assert len(manifests) == 3
        names = {m.name for m in manifests}
        assert names == {"plugin0", "plugin1", "plugin2"}


# ---------------------------------------------------------------------------
# Tests: PluginRegistry API
# ---------------------------------------------------------------------------

class TestPluginRegistry:
    def test_list_and_get(self, tmp_path: Path) -> None:
        registry = PluginRegistry()
        m = PluginManifest(name="r", version="1.0")
        registry._add(m)
        assert registry.get_plugin("r") is m
        assert m in registry.list_plugins()

    def test_remove(self) -> None:
        registry = PluginRegistry()
        m = PluginManifest(name="x", version="1.0")
        registry._add(m)
        registry._remove("x")
        assert registry.get_plugin("x") is None

    def test_get_nonexistent_returns_none(self) -> None:
        registry = PluginRegistry()
        assert registry.get_plugin("nope") is None
