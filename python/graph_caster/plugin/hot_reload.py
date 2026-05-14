# Copyright GraphCaster. All Rights Reserved.

"""Plugin hot-reload watcher — active only when GC_DEV=1 (F93)."""

from __future__ import annotations

import asyncio
import importlib
import importlib.util
import logging
import os
import sys
from pathlib import Path
from typing import Any

_log = logging.getLogger(__name__)


def _clear_pyc_cache(source_dir: Path) -> None:
    """Delete all .pyc files under source_dir/__pycache__ to force fresh re-compilation."""
    pycache = source_dir / "__pycache__"
    if not pycache.is_dir():
        return
    for pyc in pycache.glob("*.pyc"):
        try:
            pyc.unlink()
        except OSError:
            pass
    for sub in source_dir.rglob("__pycache__/*.pyc"):
        try:
            sub.unlink()
        except OSError:
            pass


def _is_dev_mode() -> bool:
    return os.environ.get("GC_DEV", "").strip() in ("1", "true", "yes")


class HotReloadWatcher:
    """Poll plugin source files for mtime changes and reload on modification.

    Only meaningful when ``GC_DEV=1``.  Each tick (default 1 s) all tracked
    ``.py`` files are stat-checked.  When a change is detected the owning
    plugin is scheduled for reload after a short debounce window (0.3 s) so
    that a burst of editor saves results in exactly one reload.
    """

    def __init__(
        self,
        loader: Any,
        *,
        search_dirs: list[Path] | None = None,
        poll_interval_sec: float = 1.0,
        debounce_sec: float = 0.3,
    ) -> None:
        self._loader = loader
        self._search_dirs: list[Path] = search_dirs or []
        self._poll_interval = poll_interval_sec
        self._debounce = debounce_sec

        self._file_mtime: dict[Path, float] = {}
        self._file_to_plugin: dict[Path, str] = {}
        self._pending: dict[str, asyncio.TimerHandle] = {}
        self._task: asyncio.Task | None = None
        self._running = False

    # ------------------------------------------------------------------
    # Public interface
    # ------------------------------------------------------------------

    async def start(self) -> None:
        """Start the background polling loop."""
        self._running = True
        self._rebuild_map()
        self._task = asyncio.get_event_loop().create_task(self._poll_loop())

    async def stop(self) -> None:
        """Stop the polling loop gracefully."""
        self._running = False
        for handle in self._pending.values():
            handle.cancel()
        self._pending.clear()
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _rebuild_map(self) -> None:
        """Rebuild {file -> plugin_name} from currently loaded plugins."""
        self._file_to_plugin.clear()
        self._file_mtime.clear()

        for manifest in self._loader.list_loaded():
            source_dir: Path | None = getattr(manifest, "_source_dir", None)
            if source_dir is None:
                continue
            for py_file in source_dir.rglob("*.py"):
                try:
                    mtime = py_file.stat().st_mtime
                except OSError:
                    continue
                self._file_to_plugin[py_file] = manifest.name
                self._file_mtime[py_file] = mtime

        for d in self._search_dirs:
            if not d.is_dir():
                continue
            for py_file in d.rglob("*.py"):
                if py_file in self._file_to_plugin:
                    continue
                try:
                    mtime = py_file.stat().st_mtime
                except OSError:
                    continue
                self._file_mtime[py_file] = mtime

    async def _poll_loop(self) -> None:
        while self._running:
            await asyncio.sleep(self._poll_interval)
            try:
                self._check_changes()
            except Exception:
                _log.exception("hot_reload poll error")

    def _check_changes(self) -> None:
        for py_file, old_mtime in list(self._file_mtime.items()):
            try:
                new_mtime = py_file.stat().st_mtime
            except OSError:
                continue
            if new_mtime != old_mtime:
                self._file_mtime[py_file] = new_mtime
                plugin_name = self._file_to_plugin.get(py_file)
                if plugin_name:
                    self._schedule_reload(plugin_name, py_file)

    def _schedule_reload(self, plugin_name: str, changed_file: Path) -> None:
        existing = self._pending.pop(plugin_name, None)
        if existing is not None:
            existing.cancel()

        loop = asyncio.get_event_loop()
        handle = loop.call_later(
            self._debounce,
            lambda: asyncio.ensure_future(
                self._do_reload(plugin_name, changed_file), loop=loop
            ),
        )
        self._pending[plugin_name] = handle

    async def _do_reload(self, plugin_name: str, reason: Path) -> None:
        self._pending.pop(plugin_name, None)
        _log.info("plugin_reloaded plugin=%s reason=%s", plugin_name, reason)

        manifest = self._loader._loaded.get(plugin_name)
        if manifest is None:
            return

        source_dir: Path | None = getattr(manifest, "_source_dir", None)

        saved_manifest = manifest
        saved_nodes = list(self._loader._plugin_nodes.get(plugin_name, []))
        saved_tools = list(self._loader._plugin_tools.get(plugin_name, []))
        saved_providers = list(self._loader._plugin_providers.get(plugin_name, []))

        try:
            await self._loader.unload(plugin_name)

            module_key = f"_gc_plugin_{plugin_name}"
            to_purge = [k for k in sys.modules if k == module_key or k.startswith(module_key + ".")]
            for k in to_purge:
                sys.modules.pop(k, None)

            if source_dir is not None:
                _clear_pyc_cache(source_dir)

            import importlib as _importlib
            _importlib.invalidate_caches()

            await self._loader.load(plugin_name)
            _log.info("plugin_reloaded plugin=%s status=ok", plugin_name)

            new_manifest = self._loader._loaded.get(plugin_name)
            if new_manifest is not None and source_dir is not None:
                new_manifest._source_dir = source_dir

            self._rebuild_map()

        except Exception as exc:
            _log.error("plugin_reload_failed plugin=%s error=%s", plugin_name, exc)
            try:
                from graph_caster.plugin.loader import (
                    _register_node,
                    _register_tool,
                    _register_model_provider,
                )
                for node_cls in saved_manifest.nodes:
                    _register_node(node_cls)
                for trigger_cls in saved_manifest.triggers:
                    _register_node(trigger_cls)
                for tool in saved_tools:
                    _register_tool(tool)
                for provider in saved_providers:
                    _register_model_provider(provider)

                self._loader._loaded[plugin_name] = saved_manifest
                self._loader._plugin_nodes[plugin_name] = saved_nodes
                self._loader._plugin_tools[plugin_name] = saved_tools
                self._loader._plugin_providers[plugin_name] = saved_providers
                self._loader._registry._add(saved_manifest)
            except Exception as inner:
                _log.error("plugin_restore_failed plugin=%s error=%s", plugin_name, inner)
