# Copyright GraphCaster. All Rights Reserved.

"""F97 — Plugin registry client: PyPI prefix search + GitHub manifest discovery."""

from __future__ import annotations

import asyncio
import importlib.metadata
import json
import os
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

_TRUST_PATH = Path.home() / ".graphcaster" / "registry-trust.json"
_ENV_MANIFEST_URLS = "GC_PLUGIN_MANIFEST_URLS"


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


@dataclass
class RegistryEntry:
    name: str
    version: str
    description: str
    homepage: str
    install_target: str
    source: Literal["pypi", "github"]
    permissions: list[str] = field(default_factory=list)
    downloads: int | None = None
    updated_at: str | None = None
    author: str = ""

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "version": self.version,
            "description": self.description,
            "homepage": self.homepage,
            "install_target": self.install_target,
            "source": self.source,
            "permissions": self.permissions,
            "downloads": self.downloads,
            "updated_at": self.updated_at,
            "author": self.author,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "RegistryEntry":
        return cls(
            name=str(d.get("name", "")),
            version=str(d.get("version", "")),
            description=str(d.get("description", "")),
            homepage=str(d.get("homepage", "")),
            install_target=str(d.get("install_target", d.get("name", ""))),
            source=d.get("source", "github"),  # type: ignore[arg-type]
            permissions=list(d.get("permissions", [])),
            downloads=d.get("downloads"),
            updated_at=d.get("updated_at"),
            author=str(d.get("author", "")),
        )


# ---------------------------------------------------------------------------
# Trust helpers
# ---------------------------------------------------------------------------


def _load_trust(trust_path: Path | None = None) -> dict:
    p = trust_path or _TRUST_PATH
    if not p.exists():
        return {}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def _save_trust(data: dict, trust_path: Path | None = None) -> None:
    p = trust_path or _TRUST_PATH
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def is_trusted(name: str, *, trust_path: Path | None = None) -> bool:
    data = _load_trust(trust_path)
    return name in data


def add_trust(name: str, *, trust_path: Path | None = None) -> None:
    data = _load_trust(trust_path)
    data[name] = True
    _save_trust(data, trust_path)


def remove_trust(name: str, *, trust_path: Path | None = None) -> None:
    data = _load_trust(trust_path)
    data.pop(name, None)
    _save_trust(data, trust_path)


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------


class PluginRegistryClient:
    """Search/install/uninstall GraphCaster plugins from PyPI and GitHub manifests."""

    def __init__(
        self,
        *,
        pypi_prefix: str = "graphcaster-plugin-",
        github_manifest_urls: list[str] | None = None,
        trust_path: Path | None = None,
        _http_client=None,
    ) -> None:
        self._pypi_prefix = pypi_prefix
        env_urls_raw = os.environ.get(_ENV_MANIFEST_URLS, "").strip()
        env_urls = [u.strip() for u in env_urls_raw.split(",") if u.strip()] if env_urls_raw else []
        self._manifest_urls: list[str] = list(github_manifest_urls or []) + env_urls
        self._trust_path = trust_path
        self._http_client = _http_client

    async def _fetch_text(self, url: str) -> str:
        """Fetch URL text; uses injected client in tests, httpx otherwise."""
        if self._http_client is not None:
            return await self._http_client.get(url)

        import httpx

        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(url)
            resp.raise_for_status()
            return resp.text

    async def _pypi_search(self) -> list[RegistryEntry]:
        """Fetch https://pypi.org/simple/ and filter by prefix."""
        try:
            text = await self._fetch_text("https://pypi.org/simple/")
        except Exception:
            return []

        entries: list[RegistryEntry] = []
        for line in text.splitlines():
            name: str | None = None
            href_start = line.find('href="')
            if href_start != -1:
                rest = line[href_start + 6:]
                href_end = rest.find('"')
                if href_end != -1:
                    href = rest[:href_end]
                    last = href.rstrip("/").rsplit("/", 1)[-1]
                    name = last
            if name is None:
                continue
            name_lower = name.lower()
            if not name_lower.startswith(self._pypi_prefix):
                continue
            entry = await self._pypi_package_info(name)
            if entry is not None:
                entries.append(entry)
        return entries

    async def _pypi_package_info(self, name: str) -> RegistryEntry | None:
        try:
            text = await self._fetch_text(f"https://pypi.org/pypi/{name}/json")
            data = json.loads(text)
        except Exception:
            return None
        info = data.get("info", {})
        version = str(info.get("version", ""))
        description = str(info.get("summary", ""))
        homepage = str(info.get("home_page") or info.get("project_url") or "")
        author = str(info.get("author", ""))
        downloads_data = data.get("downloads", {})
        downloads = downloads_data.get("last_month") if isinstance(downloads_data, dict) else None
        return RegistryEntry(
            name=name,
            version=version,
            description=description,
            homepage=homepage,
            install_target=name,
            source="pypi",
            permissions=[],
            downloads=downloads,
            updated_at=None,
            author=author,
        )

    async def _github_manifest_entries(self) -> list[RegistryEntry]:
        entries: list[RegistryEntry] = []
        for url in self._manifest_urls:
            try:
                text = await self._fetch_text(url)
                raw = json.loads(text)
            except Exception:
                continue
            if isinstance(raw, list):
                for item in raw:
                    if isinstance(item, dict):
                        entries.append(RegistryEntry.from_dict(item))
        return entries

    async def search(self, query: str = "", *, limit: int = 50) -> list[RegistryEntry]:
        """Search PyPI (by prefix) and all configured manifest URLs."""
        pypi_task = asyncio.ensure_future(self._pypi_search())
        github_task = asyncio.ensure_future(self._github_manifest_entries())
        pypi_results, github_results = await asyncio.gather(pypi_task, github_task)

        combined = {e.name: e for e in pypi_results}
        for e in github_results:
            combined[e.name] = e

        results = list(combined.values())
        if query:
            q = query.lower()
            results = [
                e for e in results
                if q in e.name.lower() or q in e.description.lower()
            ]
        return results[:limit]

    async def get(self, name: str) -> RegistryEntry | None:
        """Return info for a single plugin by name."""
        all_entries = await self.search()
        for e in all_entries:
            if e.name == name:
                return e
        return None

    async def install(
        self,
        name: str,
        *,
        version: str | None = None,
        allow_untrusted: bool = False,
    ) -> None:
        """pip-install a plugin.

        Refuses if the plugin is not in the trust file unless allow_untrusted=True.
        """
        if not allow_untrusted and not is_trusted(name, trust_path=self._trust_path):
            raise PermissionError(
                f"Plugin {name!r} is not trusted. "
                f"Run: python -m graph_caster registry trust {name}  "
                f"or pass --allow-untrusted."
            )

        target = name if version is None else f"{name}=={version}"
        result = subprocess.run(
            [sys.executable, "-m", "pip", "install", target],
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(f"pip install {target!r} failed with exit code {result.returncode}")

    async def uninstall(self, name: str) -> None:
        result = subprocess.run(
            [sys.executable, "-m", "pip", "uninstall", "-y", name],
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(f"pip uninstall {name!r} failed with exit code {result.returncode}")

    async def list_installed(self) -> list[RegistryEntry]:
        """Return installed packages registered under 'graphcaster.plugins' entry_point."""
        eps = importlib.metadata.entry_points(group="graphcaster.plugins")
        entries: list[RegistryEntry] = []
        for ep in eps:
            pkg_name = ep.value.split(":")[0].split(".")[0] if ":" in ep.value else ep.value
            try:
                dist = importlib.metadata.distribution(pkg_name)
                meta = dist.metadata
                version = str(meta.get("Version", ""))
                description = str(meta.get("Summary", ""))
                homepage = str(meta.get("Home-page") or "")
                author = str(meta.get("Author", ""))
            except importlib.metadata.PackageNotFoundError:
                version = ""
                description = ""
                homepage = ""
                author = ""
            entries.append(
                RegistryEntry(
                    name=ep.name,
                    version=version,
                    description=description,
                    homepage=homepage,
                    install_target=ep.name,
                    source="pypi",
                    permissions=[],
                    downloads=None,
                    updated_at=None,
                    author=author,
                )
            )
        return entries
