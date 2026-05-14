# Copyright GraphCaster. All Rights Reserved.

"""Plugin loader: discover, load, and unload pip-installable extensions (F92)."""

from __future__ import annotations

import asyncio
import importlib
import importlib.util
import logging
import os
import sys
from pathlib import Path
from typing import Any, Callable

from graph_caster.plugin.manifest import PluginManifest, PluginPermissions
from graph_caster.plugin.permissions import (
    PermissionGate,
    PluginNotTrustedError,
    check_permissions,
    is_plugin_trusted,
    make_gate_for_manifest,
    workspace_trust_path,
    write_trust,
)
from graph_caster.plugin.registry import PluginRegistry, get_plugin_registry

_log = logging.getLogger(__name__)

_STRICT_TRUST_ENV = "GC_PLUGINS_STRICT_TRUST"


def _strict_trust_enabled() -> bool:
    return os.environ.get(_STRICT_TRUST_ENV, "").strip().lower() in ("1", "true", "yes", "on")

_DEFAULT_SEARCH_DIRS = [
    Path.home() / ".graphcaster" / "plugins",
    Path("plugins"),
]

_ENTRY_POINT_GROUP = "graphcaster.plugins"

_node_registry_state: dict[str, list[tuple[str, float]]] = {}
_datasource_registry: dict[str, list[Any]] = {}


def _node_api_registry():
    from graph_caster.node_api import registry as _reg
    return _reg


def _register_node(cls: type) -> None:
    from graph_caster.node_api import register_class
    register_class(cls)


def _unregister_node(node_type: str, version: float) -> None:
    from graph_caster.node_api import registry as _reg
    _reg._REGISTRY.pop((node_type, version), None)


def _register_tool(tool: Any) -> None:
    try:
        from graph_caster.tools.registry import get_default_registry
        get_default_registry().register(tool)
    except ImportError:
        pass  # TODO: F64 tools registry not yet importable


def _unregister_tool(tool: Any) -> None:
    try:
        from graph_caster.tools.registry import get_default_registry
        name = getattr(tool, "name", None)
        if name is not None:
            get_default_registry().unregister(name)
    except ImportError:
        pass


def _register_model_provider(provider: Any) -> None:
    try:
        from graph_caster.llm.registry import get_default_registry
        get_default_registry().register(provider)
    except ImportError:
        pass  # TODO: F50 provider registry not yet importable


def _unregister_model_provider(provider: Any) -> None:
    try:
        from graph_caster.llm.registry import get_default_registry
        name = getattr(provider, "name", None)
        if name is not None:
            get_default_registry().unregister(name)
    except ImportError:
        pass  # TODO: F50 provider registry not yet importable


class PluginLoader:
    """Discover, load, and unload GraphCaster plugins."""

    def __init__(
        self,
        *,
        search_dirs: list[Path] | None = None,
        trust_path: Path | None = None,
        plugin_registry: PluginRegistry | None = None,
        auto_trust: bool = False,
        workspace_root: Path | None = None,
        workspace_trust_path: Path | None = None,
        run_event_sink: Callable[[dict[str, Any]], None] | Any | None = None,
        strict_trust: bool | None = None,
    ) -> None:
        self._search_dirs: list[Path] = search_dirs if search_dirs is not None else list(_DEFAULT_SEARCH_DIRS)
        self._trust_path = trust_path
        self._registry = plugin_registry or get_plugin_registry()
        self._auto_trust = auto_trust
        self._workspace_root = workspace_root
        # Explicit workspace_trust_path wins; otherwise derive from workspace_root.
        from graph_caster.plugin.permissions import workspace_trust_path as _ws_path
        if workspace_trust_path is not None:
            self._workspace_trust_path: Path | None = workspace_trust_path
        else:
            self._workspace_trust_path = _ws_path(workspace_root)
        self._run_event_sink = run_event_sink
        # If ``strict_trust`` is not specified, honour the env var at load time.
        self._strict_trust_override = strict_trust
        self._loaded: dict[str, PluginManifest] = {}
        self._plugin_nodes: dict[str, list[tuple[str, float]]] = {}
        self._plugin_tools: dict[str, list[Any]] = {}
        self._plugin_providers: dict[str, list[Any]] = {}
        self._plugin_gates: dict[str, PermissionGate] = {}
        # Track the source ("entry_point" or "local") of each load so we know
        # when the workspace trust-store check applies.
        self._plugin_sources: dict[str, str] = {}

    def _is_strict(self) -> bool:
        if self._strict_trust_override is not None:
            return bool(self._strict_trust_override)
        return _strict_trust_enabled()

    def _emit_run_event(self, event: dict[str, Any]) -> None:
        sink = self._run_event_sink
        if sink is None:
            return
        try:
            if hasattr(sink, "emit"):
                sink.emit(event)
            elif callable(sink):
                sink(event)
        except Exception:  # noqa: BLE001 — run-event sink must never break plugin loading
            _log.debug("plugin loader: run-event sink raised; ignoring", exc_info=True)

    def get_gate(self, plugin_name: str) -> PermissionGate | None:
        """Return the :class:`PermissionGate` constructed for a loaded plugin (None if not loaded)."""
        return self._plugin_gates.get(plugin_name)

    def discover_entry_points(self) -> list[str]:
        """Return names of installed packages exposing entry point graphcaster.plugins."""
        try:
            from importlib.metadata import entry_points
        except ImportError:
            return []
        eps = entry_points(group=_ENTRY_POINT_GROUP)
        return [ep.name for ep in eps]

    def discover_local(self) -> list[Path]:
        """Scan search_dirs for plugin packages (directories with __init__.py or single .py files)."""
        found: list[Path] = []
        for d in self._search_dirs:
            if not d.exists() or not d.is_dir():
                continue
            for child in sorted(d.iterdir()):
                if child.is_dir() and (child / "__init__.py").exists():
                    found.append(child)
                elif child.is_file() and child.suffix == ".py" and child.stem != "__init__":
                    found.append(child)
        return found

    async def load(self, name: str) -> PluginManifest:
        """Import the plugin, validate permissions, and register all contributions."""
        if name in self._loaded:
            return self._loaded[name]

        manifest, source = await self._import_manifest_with_source(name)

        # Workspace trust check (P0 plugin trust model).
        # Only entry-point loads go through the workspace trust gate — local
        # search-dir plugins are assumed to be owned by the workspace user.
        self._enforce_workspace_trust(manifest, source)

        required = manifest.permissions.granted_set()
        if self._auto_trust:
            write_trust(manifest.name, manifest.version, required, trust_path=self._trust_path)
        check_permissions(manifest.name, manifest.version, required, trust_path=self._trust_path)

        node_keys: list[tuple[str, float]] = []
        for node_cls in manifest.nodes:
            _register_node(node_cls)
            key = (getattr(node_cls, "type", node_cls.__name__), getattr(node_cls, "version", 1.0))
            node_keys.append(key)

        for trigger_cls in manifest.triggers:
            _register_node(trigger_cls)
            key = (getattr(trigger_cls, "type", trigger_cls.__name__), getattr(trigger_cls, "version", 1.0))
            node_keys.append(key)

        tool_list: list[Any] = []
        for tool in manifest.tools:
            _register_tool(tool)
            tool_list.append(tool)

        provider_list: list[Any] = []
        for provider in manifest.model_providers:
            _register_model_provider(provider)
            provider_list.append(provider)

        self._plugin_nodes[name] = node_keys
        self._plugin_tools[name] = tool_list
        self._plugin_providers[name] = provider_list
        self._loaded[name] = manifest
        self._plugin_sources[name] = source
        # Construct a PermissionGate so the host can hand it to the plugin's
        # register() / entry-point callable if it opts in. We always create
        # one (even with empty granted set) so callers don't have to None-check.
        self._plugin_gates[name] = make_gate_for_manifest(manifest)
        self._registry._add(manifest)

        locales_dir = manifest.locales_dir
        if locales_dir is None:
            source_dir = getattr(manifest, "_source_dir", None)
            if source_dir is not None:
                candidate = Path(source_dir) / "locales"
                if candidate.is_dir():
                    locales_dir = candidate
        if locales_dir is not None and Path(locales_dir).is_dir():
            try:
                from graph_caster.i18n.aggregator import get_aggregator
                get_aggregator().register_plugin_locales(name, Path(locales_dir))
            except Exception:
                pass

        return manifest

    async def unload(self, name: str) -> None:
        """Unregister all contributions of a loaded plugin."""
        if name not in self._loaded:
            return

        for (node_type, version) in self._plugin_nodes.pop(name, []):
            _unregister_node(node_type, version)

        for tool in self._plugin_tools.pop(name, []):
            _unregister_tool(tool)

        for provider in self._plugin_providers.pop(name, []):
            _unregister_model_provider(provider)

        self._plugin_gates.pop(name, None)
        self._plugin_sources.pop(name, None)
        del self._loaded[name]
        self._registry._remove(name)

        try:
            from graph_caster.i18n.aggregator import get_aggregator
            get_aggregator().unregister_plugin(name)
        except Exception:
            pass

    def list_loaded(self) -> list[PluginManifest]:
        return list(self._loaded.values())

    async def _import_manifest(self, name: str) -> PluginManifest:
        """Try entry points first, then local search dirs."""
        manifest, _ = await self._import_manifest_with_source(name)
        return manifest

    async def _import_manifest_with_source(self, name: str) -> tuple[PluginManifest, str]:
        """Like :meth:`_import_manifest` but also reports the discovery source."""
        manifest = await self._try_entry_point(name)
        if manifest is not None:
            return manifest, "entry_point"

        manifest = await self._try_local(name)
        if manifest is not None:
            return manifest, "local"

        raise ModuleNotFoundError(
            f"Plugin {name!r} not found via entry points or search dirs: {self._search_dirs}"
        )

    def _enforce_workspace_trust(self, manifest: PluginManifest, source: str) -> None:
        """Apply workspace trust-store policy at load time.

        Only entry-point loads are checked; local plugins are trusted by virtue
        of living in the workspace's plugins directory.
        """
        if source != "entry_point":
            return
        if self._workspace_trust_path is None:
            # No workspace context provided -> nothing to consult. The legacy
            # per-user permissions trust file still runs below.
            return
        try:
            digest = manifest.sha256()
        except Exception:
            digest = ""
        trusted = digest != "" and is_plugin_trusted(
            manifest.name, digest, trust_path=self._workspace_trust_path
        )
        if trusted:
            return

        module_path = getattr(manifest, "_source_dir", None)
        declared = sorted(manifest.permissions.granted_set())
        details = {
            "plugin": manifest.name,
            "version": manifest.version,
            "module_path": str(module_path) if module_path else None,
            "declared_permissions": declared,
            "manifest_sha256": digest,
        }
        _log.warning(
            "Untrusted plugin loaded: %s@%s (module=%s, permissions=%s). "
            "Run trust_plugin(%r) to suppress this warning.",
            manifest.name,
            manifest.version,
            details["module_path"],
            declared,
            manifest.name,
        )
        self._emit_run_event({"type": "plugin.untrusted_loaded", **details})

        if self._is_strict():
            raise PluginNotTrustedError(
                f"Plugin {manifest.name!r} is not in the workspace trust store "
                f"({self._workspace_trust_path}) and GC_PLUGINS_STRICT_TRUST is enabled. "
                f"Call trust_plugin({manifest.name!r}) to allow."
            )

    async def _try_entry_point(self, name: str) -> PluginManifest | None:
        try:
            from importlib.metadata import entry_points
        except ImportError:
            return None
        eps = entry_points(group=_ENTRY_POINT_GROUP)
        for ep in eps:
            if ep.name == name:
                try:
                    obj = ep.load()
                except Exception as exc:
                    raise ImportError(f"Failed to load entry point {name!r}: {exc}") from exc
                return _coerce_manifest(obj, name)
        return None

    async def _try_local(self, name: str) -> PluginManifest | None:
        for d in self._search_dirs:
            if not d.exists():
                continue
            pkg_dir = d / name
            if pkg_dir.is_dir() and (pkg_dir / "__init__.py").exists():
                manifest = _load_from_path(pkg_dir, name)
                manifest._source_dir = pkg_dir
                return manifest
            py_file = d / f"{name}.py"
            if py_file.is_file():
                manifest = _load_from_path(py_file, name)
                manifest._source_dir = py_file.parent
                return manifest
        return None


def _load_from_path(path: Path, name: str) -> PluginManifest:
    """Import a local plugin directory or single .py file and return its manifest."""
    if path.is_dir():
        module_path = path / "__init__.py"
        module_name = f"_gc_plugin_{name}"
    else:
        module_path = path
        module_name = f"_gc_plugin_{name}"

    spec = importlib.util.spec_from_file_location(module_name, module_path)
    if spec is None or spec.loader is None:
        raise ImportError(f"Cannot load plugin from {path}")

    parent = str(path.parent) if path.is_dir() else str(path.parent)
    if parent not in sys.path:
        sys.path.insert(0, parent)

    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    try:
        spec.loader.exec_module(module)
    except Exception as exc:
        del sys.modules[module_name]
        raise ImportError(f"Error executing plugin module {path}: {exc}") from exc

    obj = getattr(module, "manifest", None)
    if obj is None:
        raise ImportError(
            f"Plugin at {path} does not expose a 'manifest' attribute. "
            "Did you call graph_caster.plugin.declare(...)?")
    return _coerce_manifest(obj, name)


def _coerce_manifest(obj: Any, name: str) -> PluginManifest:
    """Accept a PluginManifest or a callable returning one."""
    if isinstance(obj, PluginManifest):
        return obj
    if callable(obj):
        result = obj()
        if isinstance(result, PluginManifest):
            return result
    raise TypeError(
        f"Plugin {name!r}: 'manifest' must be a PluginManifest instance or callable returning one, "
        f"got {type(obj)!r}"
    )
