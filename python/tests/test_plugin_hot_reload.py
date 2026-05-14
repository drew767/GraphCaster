# Copyright GraphCaster. All Rights Reserved.

"""Tests for HotReloadWatcher (F93)."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from typing import Any

import pytest

from graph_caster.plugin.loader import PluginLoader
from graph_caster.plugin.hot_reload import HotReloadWatcher
from graph_caster.plugin.permissions import write_trust
from graph_caster.plugin.registry import PluginRegistry


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_plugin(tmp_path: Path, plugin_name: str, return_value: int) -> Path:
    pkg_dir = tmp_path / plugin_name
    pkg_dir.mkdir(exist_ok=True)
    _write_plugin_files(pkg_dir, plugin_name, return_value)
    return pkg_dir


def _write_plugin_files(pkg_dir: Path, plugin_name: str, return_value: int) -> None:
    node_file = pkg_dir / "my_node.py"
    node_file.write_text(
        "from graph_caster.node_api import GraphCasterNode, Input, Output\n"
        "\n"
        f"_RETURN = {return_value}\n"
        "\n"
        "class MyNode(GraphCasterNode):\n"
        f"    type = 'my_node_{plugin_name}'\n"
        "    version = 1.0\n"
        "    inputs = []\n"
        "    outputs = []\n"
        "    async def run(self, ctx, **kwargs):\n"
        "        return {'value': _RETURN}\n",
        encoding="utf-8",
    )
    init_file = pkg_dir / "__init__.py"
    init_file.write_text(
        "from graph_caster.plugin import declare\n"
        "from .my_node import MyNode\n"
        "\n"
        "manifest = declare(\n"
        f"    name={plugin_name!r},\n"
        '    version="1.0.0",\n'
        "    nodes=[MyNode],\n"
        ")\n",
        encoding="utf-8",
    )


def _make_loader(tmp_path: Path, plugin_name: str) -> PluginLoader:
    trust_path = tmp_path / "trust.json"
    write_trust(plugin_name, "1.0.0", frozenset(), trust_path=trust_path)
    registry = PluginRegistry()
    return PluginLoader(
        search_dirs=[tmp_path],
        trust_path=trust_path,
        plugin_registry=registry,
        auto_trust=True,
    )


async def _node_return_value(plugin_name: str) -> int | None:
    """Look up the registered node and run it (async-safe)."""
    from graph_caster.node_api.registry import _REGISTRY
    cls = _REGISTRY.get((f"my_node_{plugin_name}", 1.0))
    if cls is None:
        return None
    instance = cls()
    result = await instance.run(None)
    return result.get("value")


def _run(coro: Any) -> Any:
    """Run a coroutine in a new event loop, then install a fresh loop so
    subsequent tests that call asyncio.get_event_loop() still find one."""
    loop = asyncio.new_event_loop()
    try:
        asyncio.set_event_loop(loop)
        return loop.run_until_complete(coro)
    finally:
        loop.close()
        fresh = asyncio.new_event_loop()
        asyncio.set_event_loop(fresh)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestHotReloadWatcher:

    def test_basic_reload_on_file_change(self, tmp_path: Path) -> None:
        """Modifying a plugin file triggers a reload; MyNode.run returns the new value."""
        pname = "hr_basic"
        pkg_dir = _make_plugin(tmp_path, pname, return_value=1)
        loader = _make_loader(tmp_path, pname)

        async def _body() -> None:
            await loader.load(pname)
            assert await _node_return_value(pname) == 1

            watcher = HotReloadWatcher(
                loader,
                search_dirs=[tmp_path],
                poll_interval_sec=0.05,
                debounce_sec=0.05,
            )
            await watcher.start()
            try:
                _write_plugin_files(pkg_dir, pname, return_value=2)

                loop = asyncio.get_event_loop()
                deadline = loop.time() + 5.0
                while loop.time() < deadline:
                    await asyncio.sleep(0.1)
                    if await _node_return_value(pname) == 2:
                        break

                assert await _node_return_value(pname) == 2
            finally:
                await watcher.stop()

        _run(_body())

    def test_unrelated_file_no_reload(self, tmp_path: Path) -> None:
        """Touching a file not owned by any plugin does not trigger a reload."""
        pname = "hr_unrelated"
        _make_plugin(tmp_path, pname, return_value=10)
        loader = _make_loader(tmp_path, pname)

        reload_count: list[int] = [0]

        async def _body() -> None:
            await loader.load(pname)

            original_unload = loader.unload

            async def counting_unload(name: str) -> None:
                reload_count[0] += 1
                await original_unload(name)

            loader.unload = counting_unload  # type: ignore[method-assign]

            watcher = HotReloadWatcher(
                loader,
                search_dirs=[tmp_path],
                poll_interval_sec=0.05,
                debounce_sec=0.05,
            )
            await watcher.start()
            try:
                unrelated = tmp_path / "unrelated_x.py"
                unrelated.write_text("# nothing\n", encoding="utf-8")
                await asyncio.sleep(0.5)
                assert reload_count[0] == 0
            finally:
                await watcher.stop()

        _run(_body())

    def test_debounce_rapid_edits(self, tmp_path: Path) -> None:
        """Rapid consecutive writes to the same file result in exactly one reload.

        All 5 writes happen synchronously (no await between them), ensuring they
        all land within a single debounce window.  Then we wait long enough for
        the debounce to settle and exactly one reload to fire.
        """
        pname = "hr_debounce"
        pkg_dir = _make_plugin(tmp_path, pname, return_value=1)
        loader = _make_loader(tmp_path, pname)

        reload_count: list[int] = [0]

        async def _body() -> None:
            await loader.load(pname)

            original_unload = loader.unload

            async def counting_unload(name: str) -> None:
                reload_count[0] += 1
                await original_unload(name)

            loader.unload = counting_unload  # type: ignore[method-assign]

            watcher = HotReloadWatcher(
                loader,
                search_dirs=[tmp_path],
                poll_interval_sec=0.05,
                debounce_sec=0.5,
            )
            await watcher.start()
            try:
                for i in range(5):
                    _write_plugin_files(pkg_dir, pname, return_value=i + 10)

                await asyncio.sleep(2.0)

                assert reload_count[0] == 1, (
                    f"Debounce should coalesce rapid edits into 1 reload, got {reload_count[0]}"
                )
            finally:
                await watcher.stop()

        _run(_body())

    def test_import_error_keeps_old_plugin(self, tmp_path: Path) -> None:
        """If a reload fails with ImportError, the old plugin stays loaded."""
        pname = "hr_err"
        pkg_dir = _make_plugin(tmp_path, pname, return_value=42)
        loader = _make_loader(tmp_path, pname)

        async def _body() -> None:
            await loader.load(pname)
            assert await _node_return_value(pname) == 42

            watcher = HotReloadWatcher(
                loader,
                search_dirs=[tmp_path],
                poll_interval_sec=0.05,
                debounce_sec=0.05,
            )
            await watcher.start()
            try:
                init_file = pkg_dir / "__init__.py"
                init_file.write_text(
                    "raise ImportError('intentional test error')\n",
                    encoding="utf-8",
                )

                await asyncio.sleep(0.6)

                assert pname in loader._loaded, "Plugin should remain loaded after failed reload"
                assert await _node_return_value(pname) == 42
            finally:
                await watcher.stop()

        _run(_body())

    def test_recovery_after_error(self, tmp_path: Path) -> None:
        """After an import error, fixing the file triggers a successful reload."""
        pname = "hr_recover"
        pkg_dir = _make_plugin(tmp_path, pname, return_value=7)
        loader = _make_loader(tmp_path, pname)

        async def _body() -> None:
            await loader.load(pname)

            watcher = HotReloadWatcher(
                loader,
                search_dirs=[tmp_path],
                poll_interval_sec=0.05,
                debounce_sec=0.05,
            )
            await watcher.start()
            try:
                init_file = pkg_dir / "__init__.py"
                init_file.write_text(
                    "raise ImportError('intentional test error')\n",
                    encoding="utf-8",
                )
                await asyncio.sleep(0.5)

                _write_plugin_files(pkg_dir, pname, return_value=99)

                loop = asyncio.get_event_loop()
                deadline = loop.time() + 5.0
                while loop.time() < deadline:
                    await asyncio.sleep(0.1)
                    if await _node_return_value(pname) == 99:
                        break

                assert await _node_return_value(pname) == 99
            finally:
                await watcher.stop()

        _run(_body())


# ---------------------------------------------------------------------------
# Synchronous map tests (no event loop needed)
# ---------------------------------------------------------------------------

class TestHotReloadWatcherMap:

    def test_rebuild_map_tracks_loaded_plugin_files(self, tmp_path: Path) -> None:
        pname = "hr_map"
        _make_plugin(tmp_path, pname, return_value=1)
        loader = _make_loader(tmp_path, pname)
        _run(loader.load(pname))

        watcher = HotReloadWatcher(loader, search_dirs=[tmp_path], poll_interval_sec=1.0)
        watcher._rebuild_map()

        tracked = set(watcher._file_to_plugin.values())
        assert pname in tracked

    def test_files_without_loaded_plugin_not_in_plugin_map(self, tmp_path: Path) -> None:
        loader = _make_loader(tmp_path, "dummy_maptest")

        extra = tmp_path / "standalone_nomatch.py"
        extra.write_text("x = 1\n", encoding="utf-8")

        watcher = HotReloadWatcher(loader, search_dirs=[tmp_path], poll_interval_sec=1.0)
        watcher._rebuild_map()

        assert extra not in watcher._file_to_plugin
