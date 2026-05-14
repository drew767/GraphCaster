# Copyright GraphCaster. All Rights Reserved.

"""Tests for plugin scaffold CLI (F96): scaffold_plugin() and CLI integration."""

from __future__ import annotations

import json
import subprocess
import sys
import tomllib
from pathlib import Path

import pytest

from graph_caster.plugin.scaffold import scaffold_plugin, _slug, _package_name

PYTHON = sys.executable


# ---------------------------------------------------------------------------
# Unit: scaffold_plugin()
# ---------------------------------------------------------------------------

class TestScaffoldPlugin:
    def test_creates_root_directory(self, tmp_path: Path) -> None:
        result = scaffold_plugin("my-plugin", target_dir=tmp_path)
        assert result == tmp_path / "my-plugin"
        assert result.is_dir()

    def test_returns_correct_path(self, tmp_path: Path) -> None:
        p = scaffold_plugin("demo", target_dir=tmp_path)
        assert p.name == "demo"

    def test_pyproject_toml_exists_and_valid(self, tmp_path: Path) -> None:
        scaffold_plugin("my-plugin", target_dir=tmp_path, description="Test plugin")
        toml_path = tmp_path / "my-plugin" / "pyproject.toml"
        assert toml_path.exists()
        data = tomllib.loads(toml_path.read_bytes().decode())
        assert data["project"]["name"] == "my-plugin"
        assert data["project"]["version"] == "0.1.0"
        assert data["project"]["description"] == "Test plugin"
        build = data["build-system"]["build-backend"]
        assert "setuptools" in build

    def test_pyproject_entry_point(self, tmp_path: Path) -> None:
        scaffold_plugin("my-plugin", target_dir=tmp_path)
        data = tomllib.loads((tmp_path / "my-plugin" / "pyproject.toml").read_bytes().decode())
        eps = data["project"]["entry-points"]["graphcaster.plugins"]
        assert "my_plugin" in eps
        assert eps["my_plugin"] == "my_plugin:manifest"

    def test_readme_created(self, tmp_path: Path) -> None:
        scaffold_plugin("my-plugin", description="Hello world", target_dir=tmp_path)
        readme = tmp_path / "my-plugin" / "README.md"
        assert readme.exists()
        text = readme.read_text(encoding="utf-8")
        assert "my-plugin" in text
        assert "Hello world" in text

    def test_package_init_exists(self, tmp_path: Path) -> None:
        scaffold_plugin("my-plugin", target_dir=tmp_path)
        assert (tmp_path / "my-plugin" / "my_plugin" / "__init__.py").exists()

    def test_nodes_py_for_node_template(self, tmp_path: Path) -> None:
        scaffold_plugin("my-plugin", target_dir=tmp_path, template="node")
        assert (tmp_path / "my-plugin" / "my_plugin" / "nodes.py").exists()

    def test_tools_py_for_tool_template(self, tmp_path: Path) -> None:
        scaffold_plugin("my-plugin", target_dir=tmp_path, template="tool")
        assert (tmp_path / "my-plugin" / "my_plugin" / "tools.py").exists()

    def test_minimal_skips_nodes_py(self, tmp_path: Path) -> None:
        scaffold_plugin("my-plugin", target_dir=tmp_path, template="minimal")
        assert not (tmp_path / "my-plugin" / "my_plugin" / "nodes.py").exists()

    def test_minimal_skips_tools_py(self, tmp_path: Path) -> None:
        scaffold_plugin("my-plugin", target_dir=tmp_path, template="minimal")
        assert not (tmp_path / "my-plugin" / "my_plugin" / "tools.py").exists()

    def test_locales_en_created(self, tmp_path: Path) -> None:
        scaffold_plugin("my-plugin", target_dir=tmp_path)
        locale_en = tmp_path / "my-plugin" / "locales" / "en" / "ui.json"
        assert locale_en.exists()
        data = json.loads(locale_en.read_text(encoding="utf-8"))
        assert isinstance(data, dict)
        assert len(data) > 0

    def test_locales_ru_created(self, tmp_path: Path) -> None:
        scaffold_plugin("my-plugin", target_dir=tmp_path)
        locale_ru = tmp_path / "my-plugin" / "locales" / "ru" / "ui.json"
        assert locale_ru.exists()

    def test_tests_dir_and_smoke_created(self, tmp_path: Path) -> None:
        scaffold_plugin("my-plugin", target_dir=tmp_path)
        assert (tmp_path / "my-plugin" / "tests" / "test_smoke.py").exists()

    def test_permissions_in_init(self, tmp_path: Path) -> None:
        scaffold_plugin("my-plugin", target_dir=tmp_path, permissions=["network", "storage"])
        init_text = (tmp_path / "my-plugin" / "my_plugin" / "__init__.py").read_text(encoding="utf-8")
        assert "network=True" in init_text
        assert "storage=True" in init_text

    def test_author_in_pyproject(self, tmp_path: Path) -> None:
        scaffold_plugin("my-plugin", author="Alice", target_dir=tmp_path)
        data = tomllib.loads((tmp_path / "my-plugin" / "pyproject.toml").read_bytes().decode())
        authors = data["project"]["authors"]
        assert any("Alice" in str(a) for a in authors)

    def test_provider_template_creates_nodes_py(self, tmp_path: Path) -> None:
        scaffold_plugin("my-plugin", target_dir=tmp_path, template="provider")
        assert (tmp_path / "my-plugin" / "my_plugin" / "nodes.py").exists()

    def test_slug_helper(self) -> None:
        assert _slug("my-plugin") == "my_plugin"
        assert _slug("My Plugin") == "my_plugin"
        assert _slug("hello") == "hello"

    def test_package_name_helper(self) -> None:
        assert _package_name("my-plugin") == "my_plugin"


# ---------------------------------------------------------------------------
# Integration: generated plugin is importable
# ---------------------------------------------------------------------------

class TestGeneratedPluginImport:
    def test_node_template_manifest_importable(self, tmp_path: Path) -> None:
        scaffold_plugin("sample-node", author="Bob", description="Sample", target_dir=tmp_path)
        plugin_dir = tmp_path / "sample-node"
        result = subprocess.run(
            [
                PYTHON, "-c",
                (
                    f"import sys; sys.path.insert(0, {str(plugin_dir)!r}); "
                    "from sample_node import manifest; "
                    "print(manifest.name)"
                ),
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == "sample-node"

    def test_minimal_template_manifest_importable(self, tmp_path: Path) -> None:
        scaffold_plugin("min-plugin", target_dir=tmp_path, template="minimal")
        plugin_dir = tmp_path / "min-plugin"
        result = subprocess.run(
            [
                PYTHON, "-c",
                (
                    f"import sys; sys.path.insert(0, {str(plugin_dir)!r}); "
                    "from min_plugin import manifest; "
                    "print(manifest.name)"
                ),
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == "min-plugin"

    def test_tool_template_manifest_importable(self, tmp_path: Path) -> None:
        scaffold_plugin("tool-plugin", target_dir=tmp_path, template="tool")
        plugin_dir = tmp_path / "tool-plugin"
        result = subprocess.run(
            [
                PYTHON, "-c",
                (
                    f"import sys; sys.path.insert(0, {str(plugin_dir)!r}); "
                    "from tool_plugin import manifest; "
                    "print(manifest.name)"
                ),
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == "tool-plugin"

    def test_node_template_manifest_version(self, tmp_path: Path) -> None:
        scaffold_plugin("ver-plugin", target_dir=tmp_path)
        plugin_dir = tmp_path / "ver-plugin"
        result = subprocess.run(
            [
                PYTHON, "-c",
                (
                    f"import sys; sys.path.insert(0, {str(plugin_dir)!r}); "
                    "from ver_plugin import manifest; "
                    "print(manifest.version)"
                ),
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == "0.1.0"


# ---------------------------------------------------------------------------
# CLI: plugin new via subprocess
# ---------------------------------------------------------------------------

class TestCLIPluginNew:
    def test_cli_plugin_new_exits_zero(self, tmp_path: Path) -> None:
        result = subprocess.run(
            [PYTHON, "-m", "graph_caster", "plugin", "new", "cli-test",
             "--dir", str(tmp_path)],
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert result.returncode == 0, result.stderr
        output = json.loads(result.stdout)
        assert "created" in output

    def test_cli_plugin_new_creates_directory(self, tmp_path: Path) -> None:
        subprocess.run(
            [PYTHON, "-m", "graph_caster", "plugin", "new", "cli-hello",
             "--dir", str(tmp_path)],
            capture_output=True,
            text=True,
            timeout=30,
            check=True,
        )
        assert (tmp_path / "cli-hello").is_dir()
        assert (tmp_path / "cli-hello" / "pyproject.toml").exists()

    def test_cli_plugin_new_with_author_and_description(self, tmp_path: Path) -> None:
        subprocess.run(
            [PYTHON, "-m", "graph_caster", "plugin", "new", "annotated-plugin",
             "--author", "Charlie",
             "--description", "A described plugin",
             "--dir", str(tmp_path)],
            capture_output=True,
            text=True,
            timeout=30,
            check=True,
        )
        data = tomllib.loads(
            (tmp_path / "annotated-plugin" / "pyproject.toml").read_bytes().decode()
        )
        assert data["project"]["description"] == "A described plugin"

    def test_cli_plugin_new_with_permissions(self, tmp_path: Path) -> None:
        subprocess.run(
            [PYTHON, "-m", "graph_caster", "plugin", "new", "net-plugin",
             "--allow", "network,storage",
             "--dir", str(tmp_path)],
            capture_output=True,
            text=True,
            timeout=30,
            check=True,
        )
        init_text = (tmp_path / "net-plugin" / "net_plugin" / "__init__.py").read_text(encoding="utf-8")
        assert "network=True" in init_text
        assert "storage=True" in init_text

    def test_cli_plugin_new_minimal_template(self, tmp_path: Path) -> None:
        subprocess.run(
            [PYTHON, "-m", "graph_caster", "plugin", "new", "min-cli",
             "--template", "minimal",
             "--dir", str(tmp_path)],
            capture_output=True,
            text=True,
            timeout=30,
            check=True,
        )
        assert not (tmp_path / "min-cli" / "min_cli" / "nodes.py").exists()

    def test_cli_plugin_new_tool_template(self, tmp_path: Path) -> None:
        subprocess.run(
            [PYTHON, "-m", "graph_caster", "plugin", "new", "tool-cli",
             "--template", "tool",
             "--dir", str(tmp_path)],
            capture_output=True,
            text=True,
            timeout=30,
            check=True,
        )
        assert (tmp_path / "tool-cli" / "tool_cli" / "tools.py").exists()

    def test_cli_plugin_publish_exits_nonzero(self) -> None:
        result = subprocess.run(
            [PYTHON, "-m", "graph_caster", "plugin", "publish", "some-plugin"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        assert result.returncode != 0
        assert "registry" in result.stderr.lower() or "manually" in result.stderr.lower()
