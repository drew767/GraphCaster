# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from graph_caster.versioning import VersionManager, _compute_hash, _snapshot_filename


def _make_draft(workspace: Path, graph_id: str, content: dict) -> None:
    """Write a draft graph JSON to graphs/<graphId>.json."""
    graphs_dir = workspace / "graphs"
    graphs_dir.mkdir(parents=True, exist_ok=True)
    (graphs_dir / f"{graph_id}.json").write_text(
        json.dumps(content, ensure_ascii=False), encoding="utf-8"
    )


def _minimal_doc(graph_id: str, title: str = "test") -> dict:
    return {
        "schemaVersion": 1,
        "meta": {"schemaVersion": 1, "graphId": graph_id, "title": title},
        "nodes": [
            {"id": "s", "type": "start", "position": {"x": 0, "y": 0}, "data": {}},
            {"id": "x", "type": "exit", "position": {"x": 100, "y": 0}, "data": {}},
        ],
        "edges": [
            {
                "id": "e1",
                "source": "s",
                "sourceHandle": "out_default",
                "target": "x",
                "targetHandle": "in_default",
                "condition": None,
            }
        ],
    }


class TestPublish:
    def test_publish_creates_v1_snapshot(self, tmp_path: Path) -> None:
        gid = "graph-001"
        doc = _minimal_doc(gid)
        _make_draft(tmp_path, gid, doc)
        mgr = VersionManager(tmp_path)

        ver = asyncio.run(mgr.publish(gid, author="alice", message="first"))

        assert ver.version == 1
        assert ver.graph_id == gid
        assert ver.author == "alice"
        assert ver.message == "first"
        assert len(ver.rev_hash) == 64  # sha256 hex
        assert ver.path is not None
        assert ver.path.is_file()

        expected_name = _snapshot_filename(1, ver.rev_hash)
        assert ver.path.name == expected_name

        vdir = tmp_path / "versions" / gid
        assert (vdir / expected_name).is_file()
        log_path = vdir / "publish-log.jsonl"
        assert log_path.is_file()
        lines = [l for l in log_path.read_text(encoding="utf-8").splitlines() if l.strip()]
        assert len(lines) == 1
        entry = json.loads(lines[0])
        assert entry["version"] == 1
        assert entry["rev_hash"] == ver.rev_hash
        assert entry["author"] == "alice"

    def test_publish_unchanged_graph_returns_existing_no_new_file(self, tmp_path: Path) -> None:
        gid = "graph-002"
        doc = _minimal_doc(gid)
        _make_draft(tmp_path, gid, doc)
        mgr = VersionManager(tmp_path)

        v1 = asyncio.run(mgr.publish(gid))
        v1_again = asyncio.run(mgr.publish(gid))

        assert v1.version == v1_again.version == 1
        assert v1.rev_hash == v1_again.rev_hash

        vdir = tmp_path / "versions" / gid
        snapshots = list(vdir.glob("v*.json"))
        assert len(snapshots) == 1  # no new snapshot created

        log_lines = [l for l in (vdir / "publish-log.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
        assert len(log_lines) == 1  # no new log entry

    def test_modify_draft_publish_creates_v2(self, tmp_path: Path) -> None:
        gid = "graph-003"
        doc = _minimal_doc(gid, "original")
        _make_draft(tmp_path, gid, doc)
        mgr = VersionManager(tmp_path)

        v1 = asyncio.run(mgr.publish(gid, message="v1"))
        assert v1.version == 1

        # Modify draft
        doc2 = _minimal_doc(gid, "modified")
        _make_draft(tmp_path, gid, doc2)

        v2 = asyncio.run(mgr.publish(gid, message="v2"))
        assert v2.version == 2
        assert v2.rev_hash != v1.rev_hash
        assert v2.path is not None
        assert v2.path.is_file()
        assert v2.path != v1.path

        vdir = tmp_path / "versions" / gid
        snapshots = sorted(vdir.glob("v*.json"))
        assert len(snapshots) == 2

        log_lines = [l for l in (vdir / "publish-log.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
        assert len(log_lines) == 2

    def test_publish_missing_draft_raises_file_not_found(self, tmp_path: Path) -> None:
        mgr = VersionManager(tmp_path)
        with pytest.raises(FileNotFoundError):
            asyncio.run(mgr.publish("nonexistent-graph"))


class TestListAndGet:
    def test_list_versions_empty(self, tmp_path: Path) -> None:
        mgr = VersionManager(tmp_path)
        gid = "graph-list-0"
        # Create draft but don't publish
        _make_draft(tmp_path, gid, _minimal_doc(gid))
        versions = asyncio.run(mgr.list_versions(gid))
        assert versions == []

    def test_list_versions_returns_all_in_order(self, tmp_path: Path) -> None:
        gid = "graph-list-1"
        _make_draft(tmp_path, gid, _minimal_doc(gid, "v1"))
        mgr = VersionManager(tmp_path)

        asyncio.run(mgr.publish(gid))
        _make_draft(tmp_path, gid, _minimal_doc(gid, "v2"))
        asyncio.run(mgr.publish(gid))
        _make_draft(tmp_path, gid, _minimal_doc(gid, "v3"))
        asyncio.run(mgr.publish(gid))

        versions = asyncio.run(mgr.list_versions(gid))
        assert len(versions) == 3
        assert [v.version for v in versions] == [1, 2, 3]
        assert all(v.graph_id == gid for v in versions)

    def test_get_version_returns_correct(self, tmp_path: Path) -> None:
        gid = "graph-get-1"
        _make_draft(tmp_path, gid, _minimal_doc(gid, "a"))
        mgr = VersionManager(tmp_path)
        asyncio.run(mgr.publish(gid, author="bob"))
        _make_draft(tmp_path, gid, _minimal_doc(gid, "b"))
        asyncio.run(mgr.publish(gid, author="carol"))

        v1 = asyncio.run(mgr.get_version(gid, 1))
        assert v1.version == 1
        assert v1.author == "bob"

        v2 = asyncio.run(mgr.get_version(gid, 2))
        assert v2.version == 2
        assert v2.author == "carol"

    def test_get_version_missing_raises_key_error(self, tmp_path: Path) -> None:
        gid = "graph-get-missing"
        _make_draft(tmp_path, gid, _minimal_doc(gid))
        mgr = VersionManager(tmp_path)
        asyncio.run(mgr.publish(gid))

        with pytest.raises(KeyError):
            asyncio.run(mgr.get_version(gid, 99))

    def test_get_latest_published_none_when_no_versions(self, tmp_path: Path) -> None:
        gid = "graph-latest-0"
        _make_draft(tmp_path, gid, _minimal_doc(gid))
        mgr = VersionManager(tmp_path)
        latest = asyncio.run(mgr.get_latest_published(gid))
        assert latest is None

    def test_get_latest_published_returns_last(self, tmp_path: Path) -> None:
        gid = "graph-latest-1"
        _make_draft(tmp_path, gid, _minimal_doc(gid, "1"))
        mgr = VersionManager(tmp_path)
        asyncio.run(mgr.publish(gid))
        _make_draft(tmp_path, gid, _minimal_doc(gid, "2"))
        asyncio.run(mgr.publish(gid))

        latest = asyncio.run(mgr.get_latest_published(gid))
        assert latest is not None
        assert latest.version == 2


class TestLoadGraph:
    def test_load_draft_when_version_none(self, tmp_path: Path) -> None:
        gid = "graph-load-draft"
        doc = _minimal_doc(gid, "draft-title")
        _make_draft(tmp_path, gid, doc)
        mgr = VersionManager(tmp_path)

        loaded = asyncio.run(mgr.load_graph(gid, version=None))
        assert loaded["meta"]["title"] == "draft-title"

    def test_load_specific_version(self, tmp_path: Path) -> None:
        gid = "graph-load-ver"
        _make_draft(tmp_path, gid, _minimal_doc(gid, "v1-title"))
        mgr = VersionManager(tmp_path)
        asyncio.run(mgr.publish(gid))

        # Modify draft to v2
        _make_draft(tmp_path, gid, _minimal_doc(gid, "v2-title"))
        asyncio.run(mgr.publish(gid))

        # Draft is now "v2-title" but v1 should still be "v1-title"
        loaded_v1 = asyncio.run(mgr.load_graph(gid, version=1))
        assert loaded_v1["meta"]["title"] == "v1-title"

        loaded_v2 = asyncio.run(mgr.load_graph(gid, version=2))
        assert loaded_v2["meta"]["title"] == "v2-title"


class TestRollback:
    def test_rollback_overwrites_draft(self, tmp_path: Path) -> None:
        gid = "graph-rollback"
        _make_draft(tmp_path, gid, _minimal_doc(gid, "original"))
        mgr = VersionManager(tmp_path)
        asyncio.run(mgr.publish(gid))

        # Make a new draft and publish
        _make_draft(tmp_path, gid, _minimal_doc(gid, "updated"))
        asyncio.run(mgr.publish(gid))

        # Rollback to v1
        asyncio.run(mgr.rollback_draft_to(gid, 1))

        draft = asyncio.run(mgr.load_graph(gid, version=None))
        assert draft["meta"]["title"] == "original"

    def test_rollback_to_nonexistent_version_raises(self, tmp_path: Path) -> None:
        gid = "graph-rollback-fail"
        _make_draft(tmp_path, gid, _minimal_doc(gid))
        mgr = VersionManager(tmp_path)
        asyncio.run(mgr.publish(gid))

        with pytest.raises(KeyError):
            asyncio.run(mgr.rollback_draft_to(gid, 99))


class TestDiff:
    def test_diff_identical_is_empty(self, tmp_path: Path) -> None:
        gid = "graph-diff-same"
        _make_draft(tmp_path, gid, _minimal_doc(gid))
        mgr = VersionManager(tmp_path)
        asyncio.run(mgr.publish(gid))

        result = asyncio.run(mgr.diff(gid, 1, None))
        assert result["nodes_added"] == []
        assert result["nodes_removed"] == []
        assert result["nodes_changed"] == []
        assert result["edges_added"] == []
        assert result["edges_removed"] == []
        assert result["edges_changed"] == []

    def test_diff_detects_added_node(self, tmp_path: Path) -> None:
        gid = "graph-diff-add"
        doc1 = _minimal_doc(gid, "v1")
        _make_draft(tmp_path, gid, doc1)
        mgr = VersionManager(tmp_path)
        asyncio.run(mgr.publish(gid))

        doc2 = _minimal_doc(gid, "v2")
        doc2["nodes"].append({"id": "new-node", "type": "task", "position": {"x": 200, "y": 0}, "data": {}})
        _make_draft(tmp_path, gid, doc2)
        asyncio.run(mgr.publish(gid))

        result = asyncio.run(mgr.diff(gid, 1, 2))
        added_ids = [n["id"] for n in result["nodes_added"]]
        assert "new-node" in added_ids
        assert result["nodes_removed"] == []

    def test_diff_detects_removed_node(self, tmp_path: Path) -> None:
        gid = "graph-diff-rm"
        doc1 = _minimal_doc(gid, "v1")
        doc1["nodes"].append({"id": "extra-node", "type": "task", "position": {"x": 200, "y": 0}, "data": {}})
        _make_draft(tmp_path, gid, doc1)
        mgr = VersionManager(tmp_path)
        asyncio.run(mgr.publish(gid))

        doc2 = _minimal_doc(gid, "v2")
        _make_draft(tmp_path, gid, doc2)
        asyncio.run(mgr.publish(gid))

        result = asyncio.run(mgr.diff(gid, 1, 2))
        removed_ids = [n["id"] for n in result["nodes_removed"]]
        assert "extra-node" in removed_ids
        assert result["nodes_added"] == []

    def test_diff_detects_changed_node(self, tmp_path: Path) -> None:
        gid = "graph-diff-chg"
        doc1 = _minimal_doc(gid, "v1")
        _make_draft(tmp_path, gid, doc1)
        mgr = VersionManager(tmp_path)
        asyncio.run(mgr.publish(gid))

        doc2 = _minimal_doc(gid, "v2")  # title change affects meta, position stays same
        # Alter the start node position
        doc2["nodes"][0]["position"] = {"x": 999, "y": 999}
        _make_draft(tmp_path, gid, doc2)
        asyncio.run(mgr.publish(gid))

        result = asyncio.run(mgr.diff(gid, 1, 2))
        changed_ids = [c["id"] for c in result["nodes_changed"]]
        assert "s" in changed_ids

    def test_diff_between_two_versions(self, tmp_path: Path) -> None:
        gid = "graph-diff-vv"
        _make_draft(tmp_path, gid, _minimal_doc(gid, "first"))
        mgr = VersionManager(tmp_path)
        asyncio.run(mgr.publish(gid))
        _make_draft(tmp_path, gid, _minimal_doc(gid, "second"))
        asyncio.run(mgr.publish(gid))

        result = asyncio.run(mgr.diff(gid, 1, 2))
        # Both have same structure but meta.title changed — meta is not in nodes so no change
        # The nodes are identical between the two versions (no structural node change)
        # but let's verify the method runs cleanly with two explicit versions
        assert isinstance(result, dict)
        assert "nodes_added" in result
