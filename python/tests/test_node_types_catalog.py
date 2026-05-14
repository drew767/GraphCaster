# Copyright GraphCaster. All Rights Reserved.

"""Consistency checks for the unified node-types catalog.

The catalog lives at ``schemas/node-types.json``. This test asserts the catalog
does not drift from the Python source of truth (``node_registry._BUILTIN_V1_TYPES``).
A matching test on the UI side (``ui/src/graph/nodeTypesCatalog.test.ts``) covers
the TypeScript half.
"""

from __future__ import annotations

import pytest

from graph_caster.node_registry import _BUILTIN_V1_TYPES
from graph_caster.node_types_catalog import (
    NodeTypeInfo,
    get_catalog_path,
    is_idempotent,
    load_node_types_catalog,
    supports_step_cache,
)


def test_catalog_json_exists() -> None:
    path = get_catalog_path()
    assert path.exists(), f"node-types.json missing at {path}"


def test_catalog_loads_and_is_nonempty() -> None:
    load_node_types_catalog.cache_clear()
    catalog = load_node_types_catalog()
    assert isinstance(catalog, dict)
    assert catalog, "node-types catalog is empty"
    for type_name, info in catalog.items():
        assert isinstance(info, NodeTypeInfo)
        assert info.type == type_name
        assert info.implemented_in, f"{type_name!r} missing implementedIn"


def test_every_python_builtin_is_in_catalog() -> None:
    """Every type registered as a built-in Python handler must be catalogued."""
    load_node_types_catalog.cache_clear()
    catalog = load_node_types_catalog()
    missing = sorted(set(_BUILTIN_V1_TYPES) - set(catalog))
    assert not missing, (
        "Node types registered in _BUILTIN_V1_TYPES but absent from "
        f"schemas/node-types.json: {missing}"
    )


def test_every_python_catalog_entry_has_handler() -> None:
    """Every catalog entry marked ``implementedIn: python`` must have a handler.

    The handler set we check against is ``_BUILTIN_V1_TYPES`` — the runner's
    built-in dispatch table. Entries that are intentionally Python-only but live
    outside ``_BUILTIN_V1_TYPES`` (e.g. node_api class-based nodes) should not
    claim ``implementedIn: ["python"]`` here without also being in that set.
    """
    load_node_types_catalog.cache_clear()
    catalog = load_node_types_catalog()
    builtin_set = set(_BUILTIN_V1_TYPES)
    offenders: list[str] = []
    for type_name, info in catalog.items():
        if info.implemented_in_python and type_name not in builtin_set:
            offenders.append(type_name)
    assert not offenders, (
        "Catalog claims these types are implemented in Python but they are not "
        f"in _BUILTIN_V1_TYPES: {sorted(offenders)}"
    )


def test_idempotent_helper() -> None:
    load_node_types_catalog.cache_clear()
    # http_request is in NON_IDEMPOTENT_NODE_KINDS — must report as not idempotent.
    assert is_idempotent("http_request") is False
    # set_variable is pure state mutation — idempotent in the catalog.
    assert is_idempotent("set_variable") is True
    # Unknown type defaults to False.
    assert is_idempotent("does_not_exist") is False


def test_supports_step_cache_helper() -> None:
    load_node_types_catalog.cache_clear()
    assert supports_step_cache("task") is True
    # Flow-only node — step cache makes no sense.
    assert supports_step_cache("fork") is False
    assert supports_step_cache("does_not_exist") is False


@pytest.mark.parametrize("type_name", sorted(_BUILTIN_V1_TYPES))
def test_each_builtin_resolves(type_name: str) -> None:
    """Each Python built-in has a catalog row claiming Python implementation."""
    load_node_types_catalog.cache_clear()
    info = load_node_types_catalog().get(type_name)
    assert info is not None, f"{type_name!r} not in catalog"
    assert info.implemented_in_python, (
        f"{type_name!r} is a Python built-in but catalog does not list 'python' "
        f"in implementedIn ({sorted(info.implemented_in)})"
    )
