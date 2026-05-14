# Copyright GraphCaster. All Rights Reserved.

"""Tests for plugin manifest dataclasses and declare() helper (F92)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from graph_caster.plugin.manifest import PluginManifest, PluginPermissions, declare


class TestPluginPermissions:
    def test_defaults_all_false(self) -> None:
        p = PluginPermissions()
        assert not p.storage
        assert not p.network
        assert not p.subprocess
        assert not p.secrets
        assert not p.model_calls

    def test_to_dict(self) -> None:
        p = PluginPermissions(network=True, secrets=True)
        d = p.to_dict()
        assert d["network"] is True
        assert d["secrets"] is True
        assert d["storage"] is False

    def test_from_dict(self) -> None:
        p = PluginPermissions.from_dict({"network": True, "storage": False})
        assert p.network is True
        assert p.storage is False

    def test_granted_set(self) -> None:
        p = PluginPermissions(network=True, model_calls=True)
        assert p.granted_set() == frozenset({"network", "model_calls"})

    def test_from_set_roundtrip(self) -> None:
        names = frozenset({"storage", "subprocess"})
        p = PluginPermissions.from_set(names)
        assert p.granted_set() == names

    def test_empty_granted_set(self) -> None:
        p = PluginPermissions()
        assert p.granted_set() == frozenset()


class TestPluginManifest:
    def test_minimal_fields(self) -> None:
        m = PluginManifest(name="test", version="1.0")
        assert m.name == "test"
        assert m.version == "1.0"
        assert m.description == ""
        assert m.nodes == []
        assert m.tools == []
        assert m.locales_dir is None

    def test_to_dict_roundtrip(self) -> None:
        m = PluginManifest(
            name="my-plugin",
            version="2.3.1",
            description="A test plugin",
            author="Alice",
            homepage="https://example.com",
            permissions=PluginPermissions(network=True),
        )
        d = m.to_dict()
        assert d["name"] == "my-plugin"
        assert d["version"] == "2.3.1"
        assert d["permissions"]["network"] is True
        assert d["permissions"]["storage"] is False

    def test_from_dict(self) -> None:
        raw = {
            "name": "p",
            "version": "1.0",
            "description": "desc",
            "author": "",
            "homepage": "",
            "permissions": {"network": True},
        }
        m = PluginManifest.from_dict(raw)
        assert m.name == "p"
        assert m.permissions.network is True

    def test_to_json(self) -> None:
        m = PluginManifest(name="j", version="0.1")
        js = m.to_json()
        parsed = json.loads(js)
        assert parsed["name"] == "j"
        assert parsed["version"] == "0.1"

    def test_locales_dir(self, tmp_path: Path) -> None:
        m = PluginManifest(name="x", version="1", locales_dir=tmp_path / "locales")
        d = m.to_dict()
        assert d["locales_dir"] is not None
        assert "locales" in d["locales_dir"]

    def test_nodes_serialized_as_names(self) -> None:
        class FakeNode:
            __name__ = "FakeNode"

        m = PluginManifest(name="x", version="1", nodes=[FakeNode])
        d = m.to_dict()
        assert d["nodes"] == ["FakeNode"]


class TestDeclare:
    def test_declare_minimal(self) -> None:
        m = declare(name="minimal", version="0.0.1")
        assert isinstance(m, PluginManifest)
        assert m.name == "minimal"
        assert m.version == "0.0.1"

    def test_declare_with_dict_permissions(self) -> None:
        m = declare(name="p", version="1.0", permissions={"network": True})
        assert m.permissions.network is True
        assert m.permissions.storage is False

    def test_declare_with_permissions_object(self) -> None:
        perms = PluginPermissions(secrets=True)
        m = declare(name="p", version="1.0", permissions=perms)
        assert m.permissions.secrets is True

    def test_declare_with_nodes(self) -> None:
        class MyNode:
            pass

        m = declare(name="p", version="1.0", nodes=[MyNode])
        assert MyNode in m.nodes

    def test_declare_with_locales_dir(self, tmp_path: Path) -> None:
        m = declare(name="p", version="1.0", locales_dir=str(tmp_path))
        assert m.locales_dir == tmp_path

    def test_declare_full(self) -> None:
        m = declare(
            name="full-plugin",
            version="3.0.0",
            description="Full",
            author="Bob",
            homepage="https://bob.dev",
            permissions={"subprocess": True, "model_calls": True},
            tools=[object()],
            model_providers=[object()],
        )
        assert m.name == "full-plugin"
        assert m.permissions.subprocess is True
        assert m.permissions.model_calls is True
        assert len(m.tools) == 1
        assert len(m.model_providers) == 1
