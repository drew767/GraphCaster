# Copyright GraphCaster. All Rights Reserved.

"""Tests for MarketplaceCatalog (F78)."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from graph_caster.marketplace import MarketplaceCatalog, TemplateMeta


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

HELLO_DOC = {
    "schemaVersion": 1,
    "meta": {
        "graphId": "hello-world",
        "title": "Hello World",
        "description": "Minimal starter graph.",
        "marketplace": {
            "badge": "Starter",
            "frameworks": [],
            "usecases": ["Demo", "Learning"],
            "author": "GraphCaster Team",
            "tags": ["starter", "hello-world"],
            "preview_image": "/static/marketplace/hello-world.png",
        },
    },
    "nodes": [
        {"id": "s1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
        {"id": "x1", "type": "exit", "position": {"x": 200, "y": 0}, "data": {}},
    ],
    "edges": [
        {
            "id": "e1",
            "source": "s1",
            "sourceHandle": "out_default",
            "target": "x1",
            "targetHandle": "in_default",
            "condition": None,
        }
    ],
}

CRON_DOC = {
    "schemaVersion": 1,
    "meta": {
        "graphId": "cron-cleanup",
        "title": "Scheduled Cleanup",
        "description": "Daily cleanup via cron.",
        "marketplace": {
            "badge": "Recommended",
            "frameworks": [],
            "usecases": ["Automation"],
            "author": "GraphCaster Team",
            "tags": ["cron", "cleanup"],
            "preview_image": None,
        },
    },
    "nodes": [
        {
            "id": "s1",
            "type": "trigger_schedule",
            "position": {"x": 0, "y": 0},
            "data": {"cron": "0 0 * * *", "timezone": "UTC"},
        },
        {"id": "x1", "type": "exit", "position": {"x": 200, "y": 0}, "data": {}},
    ],
    "edges": [
        {
            "id": "e1",
            "source": "s1",
            "sourceHandle": "out_default",
            "target": "x1",
            "targetHandle": "in_default",
            "condition": None,
        }
    ],
}

LLM_DOC = {
    "schemaVersion": 1,
    "meta": {
        "graphId": "llm-summarize",
        "title": "LLM Summarizer",
        "description": "Summarize text using an LLM node.",
        "marketplace": {
            "badge": "Popular",
            "frameworks": ["LangChain"],
            "usecases": ["Summarization", "NLP"],
            "author": "GraphCaster Team",
            "tags": ["llm", "summarization"],
            "preview_image": "/static/marketplace/llm-summarize.png",
        },
    },
    "nodes": [
        {"id": "s1", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
        {"id": "x1", "type": "exit", "position": {"x": 200, "y": 0}, "data": {}},
    ],
    "edges": [],
}


def _make_dir(tmp_path: Path) -> Path:
    d = tmp_path / "marketplace"
    d.mkdir()
    (d / "hello-world.json").write_text(json.dumps(HELLO_DOC), encoding="utf-8")
    (d / "cron-cleanup.json").write_text(json.dumps(CRON_DOC), encoding="utf-8")
    (d / "llm-summarize.json").write_text(json.dumps(LLM_DOC), encoding="utf-8")
    return d


# ---------------------------------------------------------------------------
# list() tests
# ---------------------------------------------------------------------------


def test_list_returns_all_three(tmp_path: Path) -> None:
    catalog = MarketplaceCatalog(_make_dir(tmp_path))
    items = asyncio.run(catalog.list())
    assert len(items) == 3
    ids = {m.id for m in items}
    assert ids == {"hello-world", "cron-cleanup", "llm-summarize"}


def test_list_filter_by_framework(tmp_path: Path) -> None:
    catalog = MarketplaceCatalog(_make_dir(tmp_path))
    items = asyncio.run(catalog.list(framework="LangChain"))
    assert len(items) == 1
    assert items[0].id == "llm-summarize"


def test_list_filter_by_framework_case_insensitive(tmp_path: Path) -> None:
    catalog = MarketplaceCatalog(_make_dir(tmp_path))
    items = asyncio.run(catalog.list(framework="langchain"))
    assert len(items) == 1
    assert items[0].id == "llm-summarize"


def test_list_filter_by_usecase(tmp_path: Path) -> None:
    catalog = MarketplaceCatalog(_make_dir(tmp_path))
    items = asyncio.run(catalog.list(usecase="Automation"))
    assert len(items) == 1
    assert items[0].id == "cron-cleanup"


def test_list_filter_by_usecase_case_insensitive(tmp_path: Path) -> None:
    catalog = MarketplaceCatalog(_make_dir(tmp_path))
    items = asyncio.run(catalog.list(usecase="nlp"))
    assert len(items) == 1
    assert items[0].id == "llm-summarize"


def test_list_filter_by_tag(tmp_path: Path) -> None:
    catalog = MarketplaceCatalog(_make_dir(tmp_path))
    items = asyncio.run(catalog.list(tag="starter"))
    assert len(items) == 1
    assert items[0].id == "hello-world"


def test_list_filter_no_match(tmp_path: Path) -> None:
    catalog = MarketplaceCatalog(_make_dir(tmp_path))
    items = asyncio.run(catalog.list(framework="Pinecone"))
    assert items == []


def test_list_empty_dir(tmp_path: Path) -> None:
    catalog = MarketplaceCatalog(tmp_path / "nonexistent")
    items = asyncio.run(catalog.list())
    assert items == []


# ---------------------------------------------------------------------------
# get() tests
# ---------------------------------------------------------------------------


def test_get_returns_full_json(tmp_path: Path) -> None:
    catalog = MarketplaceCatalog(_make_dir(tmp_path))
    doc = asyncio.run(catalog.get("hello-world"))
    assert doc is not None
    assert doc["meta"]["graphId"] == "hello-world"
    assert "nodes" in doc
    assert "edges" in doc


def test_get_nonexistent_returns_none(tmp_path: Path) -> None:
    catalog = MarketplaceCatalog(_make_dir(tmp_path))
    doc = asyncio.run(catalog.get("does-not-exist"))
    assert doc is None


def test_get_rejects_path_traversal(tmp_path: Path) -> None:
    catalog = MarketplaceCatalog(_make_dir(tmp_path))
    doc = asyncio.run(catalog.get("../evil"))
    assert doc is None


def test_get_all_three(tmp_path: Path) -> None:
    catalog = MarketplaceCatalog(_make_dir(tmp_path))
    for tid in ("hello-world", "cron-cleanup", "llm-summarize"):
        doc = asyncio.run(catalog.get(tid))
        assert doc is not None, f"Expected to get template {tid!r}"


# ---------------------------------------------------------------------------
# instantiate() tests
# ---------------------------------------------------------------------------


def test_instantiate_copies_to_target(tmp_path: Path) -> None:
    catalog = MarketplaceCatalog(_make_dir(tmp_path))
    target_dir = tmp_path / "graphs"

    async def run() -> Path:
        return await catalog.instantiate("hello-world", "my-first-graph", target_dir)

    dest = asyncio.run(run())
    assert dest.exists()
    assert dest.name == "my-first-graph.json"
    assert dest.parent == target_dir


def test_instantiate_updates_graph_id(tmp_path: Path) -> None:
    catalog = MarketplaceCatalog(_make_dir(tmp_path))
    target_dir = tmp_path / "graphs"

    dest = asyncio.run(catalog.instantiate("hello-world", "my-first-graph", target_dir))
    doc = json.loads(dest.read_text(encoding="utf-8"))
    assert doc["meta"]["graphId"] == "my-first-graph"


def test_instantiate_does_not_mutate_original_meta(tmp_path: Path) -> None:
    catalog = MarketplaceCatalog(_make_dir(tmp_path))
    target_dir = tmp_path / "graphs"
    asyncio.run(catalog.instantiate("hello-world", "copy1", target_dir))
    original = asyncio.run(catalog.get("hello-world"))
    assert original is not None
    assert original["meta"]["graphId"] == "hello-world"


def test_instantiate_nonexistent_raises_file_not_found(tmp_path: Path) -> None:
    catalog = MarketplaceCatalog(_make_dir(tmp_path))
    with pytest.raises(FileNotFoundError):
        asyncio.run(catalog.instantiate("no-such-template", "target", tmp_path))


def test_instantiate_rejects_unsafe_target_id(tmp_path: Path) -> None:
    catalog = MarketplaceCatalog(_make_dir(tmp_path))
    with pytest.raises(ValueError):
        asyncio.run(catalog.instantiate("hello-world", "../escape", tmp_path))


def test_instantiate_creates_target_dir(tmp_path: Path) -> None:
    catalog = MarketplaceCatalog(_make_dir(tmp_path))
    target_dir = tmp_path / "nested" / "graphs"
    assert not target_dir.exists()
    asyncio.run(catalog.instantiate("hello-world", "g1", target_dir))
    assert target_dir.is_dir()


def test_instantiate_preserves_nodes_and_edges(tmp_path: Path) -> None:
    catalog = MarketplaceCatalog(_make_dir(tmp_path))
    target_dir = tmp_path / "graphs"
    dest = asyncio.run(catalog.instantiate("hello-world", "g2", target_dir))
    doc = json.loads(dest.read_text(encoding="utf-8"))
    assert len(doc["nodes"]) == len(HELLO_DOC["nodes"])
    assert len(doc["edges"]) == len(HELLO_DOC["edges"])


# ---------------------------------------------------------------------------
# Meta dataclass shape
# ---------------------------------------------------------------------------


def test_meta_fields(tmp_path: Path) -> None:
    catalog = MarketplaceCatalog(_make_dir(tmp_path))
    items = asyncio.run(catalog.list())
    hw = next(m for m in items if m.id == "hello-world")
    assert hw.title == "Hello World"
    assert hw.badge == "Starter"
    assert hw.author == "GraphCaster Team"
    assert "starter" in hw.tags
    assert hw.preview_image == "/static/marketplace/hello-world.png"

    cl = next(m for m in items if m.id == "cron-cleanup")
    assert cl.preview_image is None
