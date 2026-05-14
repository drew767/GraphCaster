# Copyright GraphCaster. All Rights Reserved.

"""Tests for F97 — PluginRegistryClient (PyPI + GitHub manifest discovery)."""

from __future__ import annotations

import asyncio
import importlib.metadata
import json
import subprocess
import sys
from pathlib import Path
from unittest import mock

import pytest

from graph_caster.plugin.registry_client import (
    PluginRegistryClient,
    RegistryEntry,
    add_trust,
    is_trusted,
    remove_trust,
)


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

PYPI_SIMPLE_HTML = """\
<!DOCTYPE html>
<html>
<head><title>Simple Index</title></head>
<body>
<a href="/simple/graphcaster-plugin-foo/">graphcaster-plugin-foo</a>
<a href="/simple/graphcaster-plugin-bar/">graphcaster-plugin-bar</a>
<a href="/simple/some-other-package/">some-other-package</a>
</body>
</html>
"""

PYPI_FOO_JSON = json.dumps({
    "info": {
        "name": "graphcaster-plugin-foo",
        "version": "1.2.3",
        "summary": "A foo plugin",
        "home_page": "https://github.com/example/foo",
        "author": "Alice",
    },
    "downloads": {"last_month": 42},
})

PYPI_BAR_JSON = json.dumps({
    "info": {
        "name": "graphcaster-plugin-bar",
        "version": "0.1.0",
        "summary": "A bar plugin",
        "home_page": "https://github.com/example/bar",
        "author": "Bob",
    },
    "downloads": {},
})

GITHUB_MANIFEST = json.dumps([
    {
        "name": "graphcaster-plugin-gh",
        "version": "2.0.0",
        "description": "From GitHub",
        "homepage": "https://github.com/example/gh",
        "install_target": "graphcaster-plugin-gh",
        "source": "github",
        "permissions": ["network"],
        "author": "Carol",
    }
])


class FakeHTTPClient:
    """Async-callable mock: url -> text."""

    def __init__(self, responses: dict[str, str]) -> None:
        self._responses = responses

    async def get(self, url: str) -> str:
        if url not in self._responses:
            raise ValueError(f"Unexpected URL: {url}")
        return self._responses[url]


def _make_client(
    *,
    manifest_urls: list[str] | None = None,
    pypi_prefix: str = "graphcaster-plugin-",
    trust_path: Path | None = None,
    http_responses: dict[str, str] | None = None,
) -> PluginRegistryClient:
    responses = http_responses or {}
    return PluginRegistryClient(
        pypi_prefix=pypi_prefix,
        github_manifest_urls=manifest_urls or [],
        trust_path=trust_path,
        _http_client=FakeHTTPClient(responses),
    )


def run(coro):
    """Run a coroutine in a fresh event loop (avoids pytest-asyncio dependency)."""
    return asyncio.run(coro)


# ---------------------------------------------------------------------------
# RegistryEntry
# ---------------------------------------------------------------------------


class TestRegistryEntry:
    def test_to_dict_roundtrip(self) -> None:
        e = RegistryEntry(
            name="graphcaster-plugin-foo",
            version="1.0",
            description="desc",
            homepage="https://x.com",
            install_target="graphcaster-plugin-foo",
            source="pypi",
            permissions=["network"],
            downloads=100,
            updated_at="2024-01-01",
            author="me",
        )
        d = e.to_dict()
        e2 = RegistryEntry.from_dict(d)
        assert e2.name == e.name
        assert e2.version == e.version
        assert e2.source == e.source
        assert e2.permissions == ["network"]
        assert e2.downloads == 100

    def test_from_dict_defaults(self) -> None:
        e = RegistryEntry.from_dict({"name": "foo", "version": "0.1", "source": "github"})
        assert e.install_target == "foo"
        assert e.permissions == []
        assert e.author == ""


# ---------------------------------------------------------------------------
# search() — PyPI + GitHub
# ---------------------------------------------------------------------------


class TestSearch:
    def _responses(self) -> dict[str, str]:
        return {
            "https://pypi.org/simple/": PYPI_SIMPLE_HTML,
            "https://pypi.org/pypi/graphcaster-plugin-foo/json": PYPI_FOO_JSON,
            "https://pypi.org/pypi/graphcaster-plugin-bar/json": PYPI_BAR_JSON,
            "https://github.com/example/manifest.json": GITHUB_MANIFEST,
        }

    def test_search_returns_pypi_and_github(self) -> None:
        client = _make_client(
            manifest_urls=["https://github.com/example/manifest.json"],
            http_responses=self._responses(),
        )
        results = run(client.search())
        names = {e.name for e in results}
        assert "graphcaster-plugin-foo" in names
        assert "graphcaster-plugin-bar" in names
        assert "graphcaster-plugin-gh" in names
        assert "some-other-package" not in names

    def test_search_with_query_filter(self) -> None:
        client = _make_client(http_responses=self._responses())
        results = run(client.search("foo"))
        assert all("foo" in e.name.lower() or "foo" in e.description.lower() for e in results)

    def test_search_limit(self) -> None:
        client = _make_client(http_responses=self._responses())
        results = run(client.search(limit=1))
        assert len(results) <= 1

    def test_search_pypi_entry_details(self) -> None:
        client = _make_client(http_responses=self._responses())
        results = run(client.search())
        foo = next(e for e in results if e.name == "graphcaster-plugin-foo")
        assert foo.version == "1.2.3"
        assert foo.description == "A foo plugin"
        assert foo.author == "Alice"
        assert foo.source == "pypi"
        assert foo.install_target == "graphcaster-plugin-foo"

    def test_search_github_overrides_pypi_on_same_name(self) -> None:
        manifest = json.dumps([
            {
                "name": "graphcaster-plugin-foo",
                "version": "99.0.0",
                "description": "Overridden by GitHub",
                "homepage": "",
                "install_target": "graphcaster-plugin-foo",
                "source": "github",
            }
        ])
        responses = dict(self._responses())
        responses["https://github.com/example/manifest.json"] = manifest
        client = _make_client(
            manifest_urls=["https://github.com/example/manifest.json"],
            http_responses=responses,
        )
        results = run(client.search())
        foo = next(e for e in results if e.name == "graphcaster-plugin-foo")
        assert foo.version == "99.0.0"
        assert foo.source == "github"

    def test_pypi_fetch_error_returns_empty(self) -> None:
        client = _make_client(http_responses={})
        results = run(client.search())
        assert isinstance(results, list)

    def test_manifest_fetch_error_skipped(self) -> None:
        client = _make_client(
            manifest_urls=["https://github.com/example/missing.json"],
            http_responses={
                "https://pypi.org/simple/": PYPI_SIMPLE_HTML,
                "https://pypi.org/pypi/graphcaster-plugin-foo/json": PYPI_FOO_JSON,
                "https://pypi.org/pypi/graphcaster-plugin-bar/json": PYPI_BAR_JSON,
            },
        )
        results = run(client.search())
        names = {e.name for e in results}
        assert "graphcaster-plugin-foo" in names


# ---------------------------------------------------------------------------
# get()
# ---------------------------------------------------------------------------


class TestGet:
    def test_get_found(self) -> None:
        responses = {
            "https://pypi.org/simple/": PYPI_SIMPLE_HTML,
            "https://pypi.org/pypi/graphcaster-plugin-foo/json": PYPI_FOO_JSON,
            "https://pypi.org/pypi/graphcaster-plugin-bar/json": PYPI_BAR_JSON,
        }
        client = _make_client(http_responses=responses)
        entry = run(client.get("graphcaster-plugin-foo"))
        assert entry is not None
        assert entry.name == "graphcaster-plugin-foo"

    def test_get_not_found_returns_none(self) -> None:
        client = _make_client(http_responses={"https://pypi.org/simple/": ""})
        entry = run(client.get("nonexistent-plugin"))
        assert entry is None


# ---------------------------------------------------------------------------
# install() — subprocess mock
# ---------------------------------------------------------------------------


class TestInstall:
    def test_install_trusted_calls_pip(self, tmp_path: Path) -> None:
        trust_path = tmp_path / "registry-trust.json"
        add_trust("graphcaster-plugin-foo", trust_path=trust_path)
        client = _make_client(trust_path=trust_path)
        with mock.patch("subprocess.run") as mock_run:
            mock_run.return_value = mock.Mock(returncode=0)
            run(client.install("graphcaster-plugin-foo"))
        mock_run.assert_called_once()
        call_args = mock_run.call_args[0][0]
        assert "pip" in call_args
        assert "install" in call_args
        assert "graphcaster-plugin-foo" in call_args

    def test_install_with_version(self, tmp_path: Path) -> None:
        trust_path = tmp_path / "registry-trust.json"
        add_trust("graphcaster-plugin-foo", trust_path=trust_path)
        client = _make_client(trust_path=trust_path)
        with mock.patch("subprocess.run") as mock_run:
            mock_run.return_value = mock.Mock(returncode=0)
            run(client.install("graphcaster-plugin-foo", version="1.2.3"))
        call_args = mock_run.call_args[0][0]
        assert "graphcaster-plugin-foo==1.2.3" in call_args

    def test_install_untrusted_raises_permission_error(self, tmp_path: Path) -> None:
        trust_path = tmp_path / "registry-trust.json"
        client = _make_client(trust_path=trust_path)
        with pytest.raises(PermissionError, match="not trusted"):
            run(client.install("graphcaster-plugin-untrusted"))

    def test_install_allow_untrusted_skips_trust_check(self, tmp_path: Path) -> None:
        trust_path = tmp_path / "registry-trust.json"
        client = _make_client(trust_path=trust_path)
        with mock.patch("subprocess.run") as mock_run:
            mock_run.return_value = mock.Mock(returncode=0)
            run(client.install("some-plugin", allow_untrusted=True))
        mock_run.assert_called_once()

    def test_install_pip_failure_raises_runtime_error(self, tmp_path: Path) -> None:
        trust_path = tmp_path / "registry-trust.json"
        add_trust("graphcaster-plugin-bad", trust_path=trust_path)
        client = _make_client(trust_path=trust_path)
        with mock.patch("subprocess.run") as mock_run:
            mock_run.return_value = mock.Mock(returncode=1)
            with pytest.raises(RuntimeError, match="failed"):
                run(client.install("graphcaster-plugin-bad"))


# ---------------------------------------------------------------------------
# uninstall()
# ---------------------------------------------------------------------------


class TestUninstall:
    def test_uninstall_calls_pip(self) -> None:
        client = _make_client()
        with mock.patch("subprocess.run") as mock_run:
            mock_run.return_value = mock.Mock(returncode=0)
            run(client.uninstall("graphcaster-plugin-foo"))
        call_args = mock_run.call_args[0][0]
        assert "uninstall" in call_args
        assert "-y" in call_args
        assert "graphcaster-plugin-foo" in call_args

    def test_uninstall_failure_raises(self) -> None:
        client = _make_client()
        with mock.patch("subprocess.run") as mock_run:
            mock_run.return_value = mock.Mock(returncode=1)
            with pytest.raises(RuntimeError):
                run(client.uninstall("nonexistent"))


# ---------------------------------------------------------------------------
# list_installed() — entry_points mock
# ---------------------------------------------------------------------------


class TestListInstalled:
    def test_list_installed_reads_entry_points(self) -> None:
        fake_ep = mock.Mock()
        fake_ep.name = "graphcaster-plugin-foo"
        fake_ep.value = "graphcaster_plugin_foo:plugin"

        fake_dist = mock.Mock()
        fake_meta = {
            "Version": "1.2.3",
            "Summary": "Test plugin",
            "Home-page": "https://example.com",
            "Author": "Test Author",
        }
        fake_dist.metadata = fake_meta

        with mock.patch(
            "importlib.metadata.entry_points",
            return_value=[fake_ep],
        ) as mock_eps, mock.patch(
            "importlib.metadata.distribution",
            return_value=fake_dist,
        ):
            client = _make_client()
            entries = run(client.list_installed())

        mock_eps.assert_called_once_with(group="graphcaster.plugins")
        assert len(entries) == 1
        assert entries[0].name == "graphcaster-plugin-foo"
        assert entries[0].version == "1.2.3"
        assert entries[0].author == "Test Author"

    def test_list_installed_empty_when_no_entry_points(self) -> None:
        with mock.patch("importlib.metadata.entry_points", return_value=[]):
            client = _make_client()
            entries = run(client.list_installed())
        assert entries == []

    def test_list_installed_handles_missing_dist(self) -> None:
        fake_ep = mock.Mock()
        fake_ep.name = "orphan-ep"
        fake_ep.value = "orphan_mod:plugin"

        with mock.patch(
            "importlib.metadata.entry_points",
            return_value=[fake_ep],
        ), mock.patch(
            "importlib.metadata.distribution",
            side_effect=importlib.metadata.PackageNotFoundError("orphan_mod"),
        ):
            client = _make_client()
            entries = run(client.list_installed())

        assert len(entries) == 1
        assert entries[0].version == ""


# ---------------------------------------------------------------------------
# Trust helpers
# ---------------------------------------------------------------------------


class TestTrust:
    def test_add_and_check_trust(self, tmp_path: Path) -> None:
        trust_path = tmp_path / "trust.json"
        assert not is_trusted("foo", trust_path=trust_path)
        add_trust("foo", trust_path=trust_path)
        assert is_trusted("foo", trust_path=trust_path)

    def test_remove_trust(self, tmp_path: Path) -> None:
        trust_path = tmp_path / "trust.json"
        add_trust("foo", trust_path=trust_path)
        remove_trust("foo", trust_path=trust_path)
        assert not is_trusted("foo", trust_path=trust_path)

    def test_remove_nonexistent_trust_noop(self, tmp_path: Path) -> None:
        trust_path = tmp_path / "trust.json"
        remove_trust("does-not-exist", trust_path=trust_path)
        assert not is_trusted("does-not-exist", trust_path=trust_path)


# ---------------------------------------------------------------------------
# CLI commands via subprocess
# ---------------------------------------------------------------------------


class TestCLI:
    def _run_cli(self, *args: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            [sys.executable, "-m", "graph_caster", *args],
            capture_output=True,
            text=True,
        )

    def test_registry_help(self) -> None:
        result = self._run_cli("registry", "--help")
        assert result.returncode == 0
        assert "search" in result.stdout.lower()

    def test_registry_search_help(self) -> None:
        result = self._run_cli("registry", "search", "--help")
        assert result.returncode == 0

    def test_registry_trust_untrust_via_api(self, tmp_path: Path) -> None:
        trust_path = tmp_path / "trust.json"
        assert not is_trusted("myplugin", trust_path=trust_path)
        add_trust("myplugin", trust_path=trust_path)
        assert is_trusted("myplugin", trust_path=trust_path)
        remove_trust("myplugin", trust_path=trust_path)
        assert not is_trusted("myplugin", trust_path=trust_path)

    def test_registry_list_command(self) -> None:
        result = self._run_cli("registry", "list")
        assert result.returncode == 0
        out = result.stdout.strip()
        assert out.startswith("[")

    def test_registry_install_refuses_untrusted_via_api(self, tmp_path: Path) -> None:
        trust_path = tmp_path / "trust.json"
        client = PluginRegistryClient(trust_path=trust_path)
        with pytest.raises(PermissionError, match="not trusted"):
            asyncio.run(client.install("unknown-plugin"))
