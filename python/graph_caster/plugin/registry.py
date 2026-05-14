# Copyright GraphCaster. All Rights Reserved.

"""Global PluginRegistry singleton (F92)."""

from __future__ import annotations

from graph_caster.plugin.manifest import PluginManifest


class PluginRegistry:
    def __init__(self) -> None:
        self._plugins: dict[str, PluginManifest] = {}

    def _add(self, manifest: PluginManifest) -> None:
        self._plugins[manifest.name] = manifest

    def _remove(self, name: str) -> None:
        self._plugins.pop(name, None)

    def list_plugins(self) -> list[PluginManifest]:
        return list(self._plugins.values())

    def get_plugin(self, name: str) -> PluginManifest | None:
        return self._plugins.get(name)


_DEFAULT_REGISTRY = PluginRegistry()


def get_plugin_registry() -> PluginRegistry:
    return _DEFAULT_REGISTRY
