# Copyright GraphCaster. All Rights Reserved.

"""Tests for graph_caster.rag.dataset (F56 — Knowledge Base / Dataset management layer)."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

from graph_caster.rag.dataset import Dataset, DatasetMetadata

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


@pytest.fixture()
def workspace(tmp_path: Path) -> Path:
    return tmp_path


# ---------------------------------------------------------------------------
# DatasetMetadata round-trip
# ---------------------------------------------------------------------------


def test_metadata_roundtrip() -> None:
    meta = DatasetMetadata(
        id="abc",
        name="Test",
        description="desc",
        embedding_backend="hash",
        vector_backend="memory",
        splitter={"kind": "recursive", "chunk_size": 500, "chunk_overlap": 50},
        created_at="2026-01-01T00:00:00+00:00",
        updated_at="2026-01-01T00:00:00+00:00",
    )
    d = meta.to_dict()
    meta2 = DatasetMetadata.from_dict(d)
    assert meta2.id == meta.id
    assert meta2.name == meta.name
    assert meta2.splitter == meta.splitter


# ---------------------------------------------------------------------------
# create → manifest + metadata persisted
# ---------------------------------------------------------------------------


def test_create_persists_metadata(workspace: Path) -> None:
    ds = Dataset.create(workspace, "Wiki")
    meta_path = workspace / ".graphcaster" / "knowledge" / ds.metadata.id / "dataset.json"
    assert meta_path.exists(), "dataset.json must be created"
    raw = json.loads(meta_path.read_text(encoding="utf-8"))
    assert raw["name"] == "Wiki"
    assert raw["id"] == ds.metadata.id


def test_create_persists_empty_manifest(workspace: Path) -> None:
    ds = Dataset.create(workspace, "Docs")
    manifest_path = workspace / ".graphcaster" / "knowledge" / ds.metadata.id / "manifest.jsonl"
    assert manifest_path.exists(), "manifest.jsonl must be created"
    assert manifest_path.read_text(encoding="utf-8").strip() == ""


# ---------------------------------------------------------------------------
# open / list round-trips
# ---------------------------------------------------------------------------


def test_open_roundtrip(workspace: Path) -> None:
    ds = Dataset.create(workspace, "OpenTest", description="hello")
    ds2 = Dataset.open(workspace, ds.metadata.id)
    assert ds2.metadata.name == "OpenTest"
    assert ds2.metadata.description == "hello"


def test_open_missing_raises(workspace: Path) -> None:
    with pytest.raises(FileNotFoundError):
        Dataset.open(workspace, "nonexistent-id")


def test_list_returns_all(workspace: Path) -> None:
    Dataset.create(workspace, "Alpha")
    Dataset.create(workspace, "Beta")
    metas = Dataset.list(workspace)
    names = {m.name for m in metas}
    assert "Alpha" in names
    assert "Beta" in names


def test_list_empty_workspace(workspace: Path) -> None:
    assert Dataset.list(workspace) == []


# ---------------------------------------------------------------------------
# add_document → chunks indexed
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_add_document_creates_chunks(workspace: Path) -> None:
    ds = Dataset.create(workspace, "ChunkTest")
    content = "Hello world. " * 50
    doc_id = await ds.add_document("test.txt", content)
    assert doc_id, "doc_id must be non-empty"
    chunks_dir = workspace / ".graphcaster" / "knowledge" / ds.metadata.id / "chunks"
    chunk_files = list(chunks_dir.glob("*.json"))
    assert len(chunk_files) >= 1, "at least one chunk file must be written"


@pytest.mark.anyio
async def test_add_document_updates_manifest(workspace: Path) -> None:
    ds = Dataset.create(workspace, "ManifestTest")
    doc_id = await ds.add_document("file.txt", "Some content to index " * 10)
    docs = await ds.list_documents()
    assert any(d["doc_id"] == doc_id for d in docs), "doc_id must appear in manifest"


@pytest.mark.anyio
async def test_add_document_with_metadata(workspace: Path) -> None:
    ds = Dataset.create(workspace, "MetaTest")
    doc_id = await ds.add_document("src.txt", "content " * 20, metadata={"author": "Alice"})
    chunks_dir = workspace / ".graphcaster" / "knowledge" / ds.metadata.id / "chunks"
    for cf in chunks_dir.glob("*.json"):
        raw = json.loads(cf.read_text(encoding="utf-8"))
        assert raw["metadata"].get("author") == "Alice"


# ---------------------------------------------------------------------------
# query → top_k results, scored
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_query_returns_results(workspace: Path) -> None:
    ds = Dataset.create(workspace, "QueryTest")
    await ds.add_document("a.txt", "The quick brown fox jumps over the lazy dog " * 20)
    results = await ds.query("quick fox", top_k=3)
    assert len(results) >= 1
    first = results[0]
    assert "chunk_id" in first
    assert "doc_id" in first
    assert "text" in first
    assert "score" in first
    assert "metadata" in first


@pytest.mark.anyio
async def test_query_top_k_respected(workspace: Path) -> None:
    ds = Dataset.create(workspace, "TopK")
    long_text = " ".join(f"sentence {i} about things" for i in range(200))
    await ds.add_document("long.txt", long_text)
    results = await ds.query("sentence", top_k=2)
    assert len(results) <= 2


@pytest.mark.anyio
async def test_query_score_is_float(workspace: Path) -> None:
    ds = Dataset.create(workspace, "ScoreType")
    await ds.add_document("x.txt", "hello world " * 30)
    results = await ds.query("hello")
    assert all(isinstance(r["score"], float) for r in results)


# ---------------------------------------------------------------------------
# remove_document
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_remove_document(workspace: Path) -> None:
    ds = Dataset.create(workspace, "RemoveTest")
    doc_id = await ds.add_document("to_remove.txt", "content " * 20)
    await ds.remove_document(doc_id)
    docs = await ds.list_documents()
    assert not any(d["doc_id"] == doc_id for d in docs)


@pytest.mark.anyio
async def test_remove_document_missing_raises(workspace: Path) -> None:
    ds = Dataset.create(workspace, "RemoveMissing")
    with pytest.raises(KeyError):
        await ds.remove_document("ghost-id")


# ---------------------------------------------------------------------------
# delete dataset
# ---------------------------------------------------------------------------


def test_delete_removes_dir(workspace: Path) -> None:
    ds = Dataset.create(workspace, "ToDelete")
    ds_dir = workspace / ".graphcaster" / "knowledge" / ds.metadata.id
    assert ds_dir.exists()
    ds.delete()
    assert not ds_dir.exists()


def test_delete_removes_from_list(workspace: Path) -> None:
    ds = Dataset.create(workspace, "WillDelete")
    ds_id = ds.metadata.id
    ds.delete()
    metas = Dataset.list(workspace)
    assert not any(m.id == ds_id for m in metas)


# ---------------------------------------------------------------------------
# add_documents batch
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_add_documents_batch(workspace: Path) -> None:
    ds = Dataset.create(workspace, "Batch")
    items = [
        ("a.txt", "Alpha content " * 20, {"tag": "a"}),
        ("b.txt", "Beta content " * 20, {"tag": "b"}),
    ]
    ids = await ds.add_documents(items)
    assert len(ids) == 2
    docs = await ds.list_documents()
    assert len(docs) == 2


# ---------------------------------------------------------------------------
# reindex preserves doc_ids but rebuilds chunks
# ---------------------------------------------------------------------------


@pytest.mark.anyio
async def test_reindex_preserves_doc_ids(workspace: Path) -> None:
    ds = Dataset.create(workspace, "ReindexTest")
    doc_id = await ds.add_document("doc.txt", "Reindex me " * 30)
    await ds.reindex()
    docs = await ds.list_documents()
    assert any(d["doc_id"] == doc_id for d in docs), "doc_id must survive reindex"


@pytest.mark.anyio
async def test_reindex_allows_query_after(workspace: Path) -> None:
    ds = Dataset.create(workspace, "ReindexQuery")
    await ds.add_document("r.txt", "reindexed content " * 30)
    await ds.reindex()
    results = await ds.query("reindexed")
    assert len(results) >= 1


# ---------------------------------------------------------------------------
# CLI via subprocess
# ---------------------------------------------------------------------------


def _run_cli(*args: str, cwd: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "graph_caster", *args],
        capture_output=True,
        text=True,
        cwd=str(cwd),
    )


def test_cli_kb_create(workspace: Path) -> None:
    result = _run_cli("kb", "create", "--name", "CLI Wiki", "--workspace", str(workspace), cwd=workspace)
    assert result.returncode == 0, result.stderr
    out = json.loads(result.stdout)
    assert out["name"] == "CLI Wiki"
    assert "id" in out


def test_cli_kb_list(workspace: Path) -> None:
    _run_cli("kb", "create", "--name", "A", "--workspace", str(workspace), cwd=workspace)
    _run_cli("kb", "create", "--name", "B", "--workspace", str(workspace), cwd=workspace)
    result = _run_cli("kb", "list", "--workspace", str(workspace), cwd=workspace)
    assert result.returncode == 0, result.stderr
    items = json.loads(result.stdout)
    names = {i["name"] for i in items}
    assert "A" in names and "B" in names


def test_cli_kb_add_and_query(workspace: Path, tmp_path: Path) -> None:
    src_file = tmp_path / "doc.txt"
    src_file.write_text("The CLI integration test document content " * 20, encoding="utf-8")

    create_result = _run_cli("kb", "create", "--name", "CLITest", "--workspace", str(workspace), cwd=workspace)
    assert create_result.returncode == 0, create_result.stderr
    ds_id = json.loads(create_result.stdout)["id"]

    add_result = _run_cli(
        "kb", "add", ds_id,
        "--source", str(src_file),
        "--workspace", str(workspace),
        cwd=workspace,
    )
    assert add_result.returncode == 0, add_result.stderr

    query_result = _run_cli(
        "kb", "query", ds_id, "CLI integration test",
        "--top-k", "3",
        "--workspace", str(workspace),
        cwd=workspace,
    )
    assert query_result.returncode == 0, query_result.stderr
    hits = json.loads(query_result.stdout)
    assert len(hits) >= 1


def test_cli_kb_delete(workspace: Path) -> None:
    create_result = _run_cli("kb", "create", "--name", "Deletable", "--workspace", str(workspace), cwd=workspace)
    assert create_result.returncode == 0
    ds_id = json.loads(create_result.stdout)["id"]

    del_result = _run_cli("kb", "delete", ds_id, "--workspace", str(workspace), cwd=workspace)
    assert del_result.returncode == 0, del_result.stderr

    list_result = _run_cli("kb", "list", "--workspace", str(workspace), cwd=workspace)
    items = json.loads(list_result.stdout)
    assert not any(i["id"] == ds_id for i in items)


def test_cli_kb_query_missing_dataset(workspace: Path) -> None:
    result = _run_cli("kb", "query", "nonexistent", "text", "--workspace", str(workspace), cwd=workspace)
    assert result.returncode == 2
