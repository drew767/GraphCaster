# Copyright GraphCaster. All Rights Reserved.

"""Variable store backends: InMemoryVariableStore and FileVariableStore."""

from __future__ import annotations

import json
import os
import tempfile
from collections import defaultdict
from pathlib import Path
from typing import Any

from .lifecycle import VariableScope, VariableStore


class InMemoryVariableStore(VariableStore):
    """Dict-backed store with no persistence. Default for unit tests."""

    def __init__(self) -> None:
        # scope -> { namespaced_key -> value }
        self._data: dict[VariableScope, dict[str, Any]] = defaultdict(dict)

    async def get(self, scope: VariableScope, key: str, default: Any = None) -> Any:
        return self._data[scope].get(key, default)

    async def set(self, scope: VariableScope, key: str, value: Any) -> None:
        self._data[scope][key] = value

    async def delete(self, scope: VariableScope, key: str) -> None:
        self._data[scope].pop(key, None)

    async def list(self, scope: VariableScope) -> dict[str, Any]:
        return dict(self._data[scope])


class FileVariableStore(VariableStore):
    """JSON-on-disk variable store.

    Layout under *root*:
      tenants/<tenant_id>/tenant.json          -- TENANT scope
      tenants/<tenant_id>/sessions/<sid>.json  -- SESSION scope
      tenants/<tenant_id>/env.json             -- ENV scope (read-only; hot-reload on mtime change)

    Run scope is not persisted (held in VariableContext._run_vars).
    System scope is read-only and provided at VariableContext construction time.

    Writes are atomic: write to a temp file in the same directory, then os.replace().
    """

    def __init__(self, root: Path, tenant_id: str = "default") -> None:
        self._root = Path(root)
        self._tenant_id = tenant_id
        # env hot-reload state
        self._env_mtime: float | None = None
        self._env_cache: dict[str, Any] = {}

    # ------------------------------------------------------------------
    # Path helpers

    def _tenant_dir(self) -> Path:
        return self._root / "tenants" / self._tenant_id

    def _tenant_file(self) -> Path:
        return self._tenant_dir() / "tenant.json"

    def _session_file(self, session_key: str) -> Path:
        # session_key is "<session_id>/some_key" — we only need the session_id portion
        # But to keep the interface consistent, the full namespaced key is used; the
        # session_id is the prefix before the first "/".
        # We deduce the session-id from the namespaced key prefix here.
        # This method is called with the raw key as-is; session identification is done
        # from the key prefix by VariableContext (e.g. "<session_id>/<varname>").
        # For raw listing, we store per-session: tenants/<tid>/sessions/<sid>.json
        # Here the full namespaced key is stored as the dict key inside the JSON.
        return self._tenant_dir() / "sessions" / "_session_.json"

    def _env_file(self) -> Path:
        return self._tenant_dir() / "env.json"

    # ------------------------------------------------------------------
    # Atomic JSON helpers

    def _read_json(self, path: Path) -> dict[str, Any]:
        if not path.exists():
            return {}
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return {}

    def _write_json(self, path: Path, data: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False)
        except Exception:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
        os.replace(tmp, path)

    # ------------------------------------------------------------------
    # Scope → storage file mapping

    def _file_for_scope(self, scope: VariableScope) -> Path | None:
        if scope == VariableScope.TENANT:
            return self._tenant_file()
        if scope == VariableScope.SESSION:
            # All session data goes into a single sessions.json dict keyed by namespaced key
            return self._tenant_dir() / "sessions.json"
        return None  # ENV is handled separately; RUN/SYS not stored

    # ------------------------------------------------------------------
    # ENV hot-reload

    def _load_env(self) -> dict[str, Any]:
        path = self._env_file()
        if not path.exists():
            return {}
        try:
            mtime = path.stat().st_mtime
        except OSError:
            return {}
        if mtime != self._env_mtime:
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(data, dict):
                    self._env_cache = data
                else:
                    self._env_cache = {}
            except (json.JSONDecodeError, OSError):
                self._env_cache = {}
            self._env_mtime = mtime
        return self._env_cache

    # ------------------------------------------------------------------
    # Abstract interface

    async def get(self, scope: VariableScope, key: str, default: Any = None) -> Any:
        if scope == VariableScope.ENV:
            return self._load_env().get(key, default)
        path = self._file_for_scope(scope)
        if path is None:
            return default
        data = self._read_json(path)
        return data.get(key, default)

    async def set(self, scope: VariableScope, key: str, value: Any) -> None:
        if scope in (VariableScope.ENV, VariableScope.SYSTEM):
            raise ValueError(f"{scope} scope is read-only")
        path = self._file_for_scope(scope)
        if path is None:
            return
        data = self._read_json(path)
        data[key] = value
        self._write_json(path, data)

    async def delete(self, scope: VariableScope, key: str) -> None:
        if scope in (VariableScope.ENV, VariableScope.SYSTEM):
            raise ValueError(f"{scope} scope is read-only")
        path = self._file_for_scope(scope)
        if path is None:
            return
        if not path.exists():
            return
        data = self._read_json(path)
        data.pop(key, None)
        self._write_json(path, data)

    async def list(self, scope: VariableScope) -> dict[str, Any]:
        if scope == VariableScope.ENV:
            return dict(self._load_env())
        path = self._file_for_scope(scope)
        if path is None:
            return {}
        return self._read_json(path)
