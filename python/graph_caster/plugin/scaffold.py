# Copyright GraphCaster. All Rights Reserved.

"""Plugin scaffold generator (F96): creates a working plugin skeleton directory."""

from __future__ import annotations

import ast
import re
from pathlib import Path
from string import Template
from typing import Literal


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _slug(name: str) -> str:
    """Convert a plugin name like 'my-plugin' to a valid Python identifier slug."""
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_") or "plugin"


def _package_name(name: str) -> str:
    """Derive the Python package directory name from a plugin name."""
    return _slug(name)


# ---------------------------------------------------------------------------
# Template strings (stdlib string.Template — $var or ${var})
# ---------------------------------------------------------------------------

_PYPROJECT_TOML = Template("""\
[build-system]
requires = ["setuptools>=61"]
build-backend = "setuptools.build_meta"

[project]
name = "$name"
version = "0.1.0"
description = "$description"
authors = [{name = "$author"}]

[project.entry-points."graphcaster.plugins"]
$slug = "$package:manifest"

[project.optional-dependencies]
dev = ["pytest>=7", "pytest-anyio>=0.0.0", "graph-caster"]
""")

_README_MD = Template("""\
# $name

$description

## Usage

Install:

```bash
pip install -e .
```

Load in GraphCaster:

```bash
python -m graph_caster plugin trust $name --allow $permissions_str
python -m graph_caster plugin load $name
```

## Development

```bash
pip install -e ".[dev]"
pytest tests/
```
""")

# __init__.py variants per template type

_INIT_NODE = Template("""\
from graph_caster.plugin import declare
from graph_caster.plugin.manifest import PluginPermissions

from .nodes import ExampleNode

manifest = declare(
    name="$name",
    version="0.1.0",
    description="$description",
    author="$author",
    permissions=PluginPermissions($perms_kwargs),
    nodes=[ExampleNode],
)
""")

_INIT_TOOL = Template("""\
from graph_caster.plugin import declare
from graph_caster.plugin.manifest import PluginPermissions

from .tools import example_tool

manifest = declare(
    name="$name",
    version="0.1.0",
    description="$description",
    author="$author",
    permissions=PluginPermissions($perms_kwargs),
    tools=[example_tool],
)
""")

_INIT_MINIMAL = Template("""\
from graph_caster.plugin import declare
from graph_caster.plugin.manifest import PluginPermissions

manifest = declare(
    name="$name",
    version="0.1.0",
    description="$description",
    author="$author",
    permissions=PluginPermissions($perms_kwargs),
)
""")

_INIT_PROVIDER = Template("""\
from graph_caster.plugin import declare
from graph_caster.plugin.manifest import PluginPermissions

manifest = declare(
    name="$name",
    version="0.1.0",
    description="$description",
    author="$author",
    permissions=PluginPermissions($perms_kwargs),
)
""")

_NODES_PY = Template("""\
from __future__ import annotations

from typing import Any, ClassVar

from graph_caster.node_api import GraphCasterNode, Input, Output


class ExampleNode(GraphCasterNode):
    type: ClassVar[str] = "${slug}_example"
    display_name: ClassVar[str] = "Example"
    inputs: ClassVar[list[Input]] = [
        Input("value", str, required=True),
    ]
    outputs: ClassVar[list[Output]] = [Output("result", str)]

    async def run(self, ctx: Any, **kwargs: Any) -> dict[str, Any]:
        return {"result": kwargs.get("value", "")}
""")

_TOOLS_PY = Template("""\
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class ExampleTool:
    name: str = "${slug}_echo"
    description: str = "Echo the input string."

    def __call__(self, text: str) -> str:
        return text


example_tool = ExampleTool()
""")

_LOCALE_EN = Template("""\
{
  "${slug}_example.display_name": "Example",
  "${slug}_example.inputs.value.label": "Value",
  "${slug}_example.outputs.result.label": "Result"
}
""")

_LOCALE_RU = Template("""\
{
  "${slug}_example.display_name": "Пример",
  "${slug}_example.inputs.value.label": "Значение",
  "${slug}_example.outputs.result.label": "Результат"
}
""")

_TEST_SMOKE_NODE = Template("""\
from __future__ import annotations

import subprocess
import sys
import tomllib
from pathlib import Path

PLUGIN_DIR = Path(__file__).resolve().parents[1]
PACKAGE = "$package"


def test_directory_structure() -> None:
    assert (PLUGIN_DIR / "pyproject.toml").exists()
    assert (PLUGIN_DIR / PACKAGE / "__init__.py").exists()
    assert (PLUGIN_DIR / "locales" / "en" / "ui.json").exists()
    assert (PLUGIN_DIR / "locales" / "ru" / "ui.json").exists()


def test_pyproject_toml_valid() -> None:
    raw = (PLUGIN_DIR / "pyproject.toml").read_bytes()
    data = tomllib.loads(raw.decode())
    assert data["project"]["name"] == "$name"
    assert data["project"]["version"] == "0.1.0"
    eps = data["project"]["entry-points"]["graphcaster.plugins"]
    assert "$slug" in eps


def test_manifest_importable() -> None:
    result = subprocess.run(
        [sys.executable, "-c",
         f"import sys; sys.path.insert(0, str({str(PLUGIN_DIR)!r})); "
         f"from {PACKAGE} import manifest; "
         f"print(manifest.name)"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "$name"
""")

_TEST_SMOKE_MINIMAL = Template("""\
from __future__ import annotations

import subprocess
import sys
import tomllib
from pathlib import Path

PLUGIN_DIR = Path(__file__).resolve().parents[1]
PACKAGE = "$package"


def test_directory_structure() -> None:
    assert (PLUGIN_DIR / "pyproject.toml").exists()
    assert (PLUGIN_DIR / PACKAGE / "__init__.py").exists()
    assert (PLUGIN_DIR / "locales" / "en" / "ui.json").exists()
    assert (PLUGIN_DIR / "locales" / "ru" / "ui.json").exists()


def test_pyproject_toml_valid() -> None:
    raw = (PLUGIN_DIR / "pyproject.toml").read_bytes()
    data = tomllib.loads(raw.decode())
    assert data["project"]["name"] == "$name"
    assert data["project"]["version"] == "0.1.0"
    eps = data["project"]["entry-points"]["graphcaster.plugins"]
    assert "$slug" in eps


def test_manifest_importable() -> None:
    result = subprocess.run(
        [sys.executable, "-c",
         f"import sys; sys.path.insert(0, str({str(PLUGIN_DIR)!r})); "
         f"from {PACKAGE} import manifest; "
         f"print(manifest.name)"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "$name"
""")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def scaffold_plugin(
    name: str,
    *,
    author: str = "",
    description: str = "",
    permissions: list[str] | None = None,
    target_dir: Path = Path("."),
    template: Literal["minimal", "node", "tool", "provider"] = "node",
) -> Path:
    """Create a directory ``<target_dir>/<name>/`` with a working plugin skeleton.

    Returns the created path.
    """
    permissions = permissions or []
    slug = _slug(name)
    package = _package_name(name)
    target_dir = Path(target_dir)
    root = target_dir / name
    root.mkdir(parents=True, exist_ok=True)

    perms_set = set(permissions)
    perms_kwargs = ", ".join(
        f"{p}=True"
        for p in ("storage", "network", "subprocess", "secrets", "model_calls")
        if p in perms_set
    )
    permissions_str = ",".join(sorted(perms_set)) if perms_set else "none"

    ctx: dict[str, str] = {
        "name": name,
        "slug": slug,
        "package": package,
        "author": author,
        "description": description,
        "perms_kwargs": perms_kwargs,
        "permissions_str": permissions_str,
    }

    # pyproject.toml
    (root / "pyproject.toml").write_text(
        _PYPROJECT_TOML.safe_substitute(ctx), encoding="utf-8"
    )

    # README.md
    (root / "README.md").write_text(
        _README_MD.safe_substitute(ctx), encoding="utf-8"
    )

    # package/__init__.py
    pkg_dir = root / package
    pkg_dir.mkdir(exist_ok=True)

    if template == "minimal":
        init_src = _INIT_MINIMAL.safe_substitute(ctx)
    elif template == "tool":
        init_src = _INIT_TOOL.safe_substitute(ctx)
    elif template == "provider":
        init_src = _INIT_PROVIDER.safe_substitute(ctx)
    else:
        init_src = _INIT_NODE.safe_substitute(ctx)

    (pkg_dir / "__init__.py").write_text(init_src, encoding="utf-8")

    # nodes.py (node / provider templates)
    if template in ("node", "provider"):
        (pkg_dir / "nodes.py").write_text(
            _NODES_PY.safe_substitute(ctx), encoding="utf-8"
        )

    # tools.py
    if template == "tool":
        (pkg_dir / "tools.py").write_text(
            _TOOLS_PY.safe_substitute(ctx), encoding="utf-8"
        )

    # locales/
    for locale, tmpl in (("en", _LOCALE_EN), ("ru", _LOCALE_RU)):
        locale_dir = root / "locales" / locale
        locale_dir.mkdir(parents=True, exist_ok=True)
        (locale_dir / "ui.json").write_text(
            tmpl.safe_substitute(ctx), encoding="utf-8"
        )

    # tests/
    tests_dir = root / "tests"
    tests_dir.mkdir(exist_ok=True)
    (tests_dir / "__init__.py").write_text("", encoding="utf-8")

    if template == "minimal":
        smoke_src = _TEST_SMOKE_MINIMAL.safe_substitute(ctx)
    else:
        smoke_src = _TEST_SMOKE_NODE.safe_substitute(ctx)

    (tests_dir / "test_smoke.py").write_text(smoke_src, encoding="utf-8")

    return root


def _validate_ast(path: Path) -> None:
    """Raise SyntaxError if ``path`` is not valid Python."""
    src = path.read_text(encoding="utf-8")
    ast.parse(src, filename=str(path))
