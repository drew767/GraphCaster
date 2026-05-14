# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from graph_caster.sharing import (
    ShareLink,
    ShareLinkExhaustedError,
    ShareLinkExpiredError,
    ShareLinkNotFoundError,
    ShareLinkStore,
)


def _store(tmp_path: Path) -> ShareLinkStore:
    return ShareLinkStore(tmp_path)


def _link(
    graph_id: str = "graph-1",
    permissions: str = "view",
    max_uses: int | None = None,
    expires_at: str | None = None,
    created_by: str = "user-1",
    metadata: dict | None = None,
) -> ShareLink:
    return ShareLink(
        id="",
        graph_id=graph_id,
        graph_version=None,
        permissions=permissions,
        expires_at=expires_at,
        max_uses=max_uses,
        uses=0,
        created_by=created_by,
        created_at="",
        metadata=metadata or {},
    )


class TestShareLinkStoreCreate:
    def test_create_assigns_id_and_created_at(self, tmp_path: Path) -> None:
        store = _store(tmp_path)
        lnk = asyncio.run(store.create(_link()))
        assert lnk.id
        assert lnk.created_at

    def test_create_persists_to_file(self, tmp_path: Path) -> None:
        store = _store(tmp_path)
        lnk = asyncio.run(store.create(_link(graph_id="g1")))
        store2 = _store(tmp_path)
        fetched = asyncio.run(store2.get(lnk.id))
        assert fetched is not None
        assert fetched.graph_id == "g1"

    def test_create_multiple_links(self, tmp_path: Path) -> None:
        store = _store(tmp_path)
        a = asyncio.run(store.create(_link(graph_id="g1")))
        b = asyncio.run(store.create(_link(graph_id="g2")))
        assert a.id != b.id

    def test_create_with_metadata(self, tmp_path: Path) -> None:
        store = _store(tmp_path)
        meta = {"title": "My graph", "description": "desc"}
        lnk = asyncio.run(store.create(_link(metadata=meta)))
        fetched = asyncio.run(store.get(lnk.id))
        assert fetched is not None
        assert fetched.metadata == meta


class TestShareLinkStoreGet:
    def test_get_returns_none_for_unknown(self, tmp_path: Path) -> None:
        store = _store(tmp_path)
        result = asyncio.run(store.get("no-such-id"))
        assert result is None

    def test_get_check_expired_returns_none_for_expired(self, tmp_path: Path) -> None:
        store = _store(tmp_path)
        lnk = asyncio.run(store.create(_link(expires_at="2000-01-01T00:00:00+00:00")))
        result = asyncio.run(store.get(lnk.id, check_expired=True))
        assert result is None

    def test_get_without_check_expired_returns_expired_link(self, tmp_path: Path) -> None:
        store = _store(tmp_path)
        lnk = asyncio.run(store.create(_link(expires_at="2000-01-01T00:00:00+00:00")))
        result = asyncio.run(store.get(lnk.id, check_expired=False))
        assert result is not None

    def test_get_check_expired_returns_none_for_exhausted(self, tmp_path: Path) -> None:
        store = _store(tmp_path)
        lnk = asyncio.run(store.create(_link(max_uses=2)))
        asyncio.run(store.consume(lnk.id))
        asyncio.run(store.consume(lnk.id))
        result = asyncio.run(store.get(lnk.id, check_expired=True))
        assert result is None


class TestShareLinkStoreList:
    def test_list_for_graph_returns_only_matching(self, tmp_path: Path) -> None:
        store = _store(tmp_path)
        asyncio.run(store.create(_link(graph_id="g1")))
        asyncio.run(store.create(_link(graph_id="g1")))
        asyncio.run(store.create(_link(graph_id="g2")))
        results = asyncio.run(store.list_for_graph("g1"))
        assert len(results) == 2
        assert all(r.graph_id == "g1" for r in results)

    def test_list_for_graph_empty_when_none(self, tmp_path: Path) -> None:
        store = _store(tmp_path)
        results = asyncio.run(store.list_for_graph("no-such-graph"))
        assert results == []

    def test_list_for_user_returns_only_matching(self, tmp_path: Path) -> None:
        store = _store(tmp_path)
        asyncio.run(store.create(_link(created_by="alice")))
        asyncio.run(store.create(_link(created_by="alice")))
        asyncio.run(store.create(_link(created_by="bob")))
        results = asyncio.run(store.list_for_user("alice"))
        assert len(results) == 2
        assert all(r.created_by == "alice" for r in results)


class TestShareLinkStoreRevoke:
    def test_revoke_removes_link(self, tmp_path: Path) -> None:
        store = _store(tmp_path)
        lnk = asyncio.run(store.create(_link()))
        asyncio.run(store.revoke(lnk.id))
        result = asyncio.run(store.get(lnk.id))
        assert result is None

    def test_revoke_unknown_raises(self, tmp_path: Path) -> None:
        store = _store(tmp_path)
        with pytest.raises(ShareLinkNotFoundError):
            asyncio.run(store.revoke("no-such-id"))

    def test_revoke_does_not_affect_other_links(self, tmp_path: Path) -> None:
        store = _store(tmp_path)
        a = asyncio.run(store.create(_link(graph_id="g1")))
        b = asyncio.run(store.create(_link(graph_id="g2")))
        asyncio.run(store.revoke(a.id))
        still_there = asyncio.run(store.get(b.id))
        assert still_there is not None


class TestShareLinkStoreConsume:
    def test_consume_increments_uses(self, tmp_path: Path) -> None:
        store = _store(tmp_path)
        lnk = asyncio.run(store.create(_link(max_uses=5)))
        asyncio.run(store.consume(lnk.id))
        asyncio.run(store.consume(lnk.id))
        fetched = asyncio.run(store.get(lnk.id))
        assert fetched is not None
        assert fetched.uses == 2

    def test_consume_raises_after_max_uses(self, tmp_path: Path) -> None:
        store = _store(tmp_path)
        lnk = asyncio.run(store.create(_link(max_uses=2)))
        asyncio.run(store.consume(lnk.id))
        asyncio.run(store.consume(lnk.id))
        with pytest.raises(ShareLinkExhaustedError):
            asyncio.run(store.consume(lnk.id))

    def test_consume_unlimited_never_exhausted(self, tmp_path: Path) -> None:
        store = _store(tmp_path)
        lnk = asyncio.run(store.create(_link(max_uses=None)))
        for _ in range(10):
            asyncio.run(store.consume(lnk.id))
        fetched = asyncio.run(store.get(lnk.id))
        assert fetched is not None
        assert fetched.uses == 10

    def test_consume_expired_raises(self, tmp_path: Path) -> None:
        store = _store(tmp_path)
        lnk = asyncio.run(store.create(_link(expires_at="2000-01-01T00:00:00+00:00")))
        with pytest.raises(ShareLinkExpiredError):
            asyncio.run(store.consume(lnk.id))

    def test_consume_unknown_raises(self, tmp_path: Path) -> None:
        store = _store(tmp_path)
        with pytest.raises(ShareLinkNotFoundError):
            asyncio.run(store.consume("no-such-id"))


class TestShareLinkModel:
    def test_to_dict_round_trip(self) -> None:
        lnk = ShareLink(
            id="abc",
            graph_id="g1",
            graph_version=2,
            permissions="view-and-run",
            expires_at="2099-01-01T00:00:00+00:00",
            max_uses=10,
            uses=3,
            created_by="user1",
            created_at="2026-01-01T00:00:00+00:00",
            metadata={"title": "test"},
        )
        d = lnk.to_dict()
        restored = ShareLink.from_dict(d)
        assert restored.id == lnk.id
        assert restored.graph_id == lnk.graph_id
        assert restored.graph_version == lnk.graph_version
        assert restored.permissions == lnk.permissions
        assert restored.expires_at == lnk.expires_at
        assert restored.max_uses == lnk.max_uses
        assert restored.uses == lnk.uses
        assert restored.metadata == lnk.metadata

    def test_allows_run_permissions(self) -> None:
        assert ShareLink(id="", graph_id="g", graph_version=None, permissions="run",
                         expires_at=None, max_uses=None).allows_run()
        assert ShareLink(id="", graph_id="g", graph_version=None, permissions="view-and-run",
                         expires_at=None, max_uses=None).allows_run()
        assert not ShareLink(id="", graph_id="g", graph_version=None, permissions="view",
                             expires_at=None, max_uses=None).allows_run()

    def test_is_expired(self) -> None:
        past = ShareLink(id="", graph_id="g", graph_version=None, permissions="view",
                         expires_at="2000-01-01T00:00:00+00:00", max_uses=None)
        future = ShareLink(id="", graph_id="g", graph_version=None, permissions="view",
                           expires_at="2099-01-01T00:00:00+00:00", max_uses=None)
        never = ShareLink(id="", graph_id="g", graph_version=None, permissions="view",
                          expires_at=None, max_uses=None)
        assert past.is_expired()
        assert not future.is_expired()
        assert not never.is_expired()
