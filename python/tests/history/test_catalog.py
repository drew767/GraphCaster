# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from graph_caster.history.catalog import RunCatalog, RunFilter, RunRecord, RunStatus


class TestRunCatalog:
    @pytest.fixture
    def catalog(self, tmp_path):
        c = RunCatalog(tmp_path / "runs.db")
        try:
            yield c
        finally:
            c.close()

    def test_insert_and_get_run(self, catalog):
        record = RunRecord(
            run_id="run-123",
            graph_id="graph-456",
            graph_name="My Workflow",
            status=RunStatus.RUNNING,
            started_at=datetime.now(timezone.utc),
            node_count=5,
            event_count=0,
        )
        catalog.insert(record)
        loaded = catalog.get("run-123")
        assert loaded is not None
        assert loaded.run_id == "run-123"
        assert loaded.graph_name == "My Workflow"
        assert loaded.status == RunStatus.RUNNING

    def test_update_run_status(self, catalog):
        record = RunRecord(
            run_id="run-123",
            graph_id="graph-456",
            graph_name="Test",
            status=RunStatus.RUNNING,
            started_at=datetime.now(timezone.utc),
        )
        catalog.insert(record)
        catalog.update_status(
            "run-123",
            RunStatus.COMPLETED,
            finished_at=datetime.now(timezone.utc),
            event_count=42,
        )
        loaded = catalog.get("run-123")
        assert loaded is not None
        assert loaded.status == RunStatus.COMPLETED
        assert loaded.event_count == 42

    def test_list_runs_with_filter(self, catalog):
        now = datetime.now(timezone.utc)
        for i in range(10):
            status = RunStatus.COMPLETED if i % 2 == 0 else RunStatus.FAILED
            catalog.insert(
                RunRecord(
                    run_id=f"run-{i}",
                    graph_id="graph-1",
                    graph_name="Test",
                    status=status,
                    started_at=now - timedelta(hours=i),
                )
            )
        completed = catalog.list(RunFilter(status=RunStatus.COMPLETED))
        assert len(completed) == 5
        recent = catalog.list(RunFilter(started_after=now - timedelta(hours=3)))
        assert len(recent) == 4

    def test_pagination(self, catalog):
        now = datetime.now(timezone.utc)
        for i in range(20):
            catalog.insert(
                RunRecord(
                    run_id=f"run-{i}",
                    graph_id="graph-1",
                    graph_name="Test",
                    status=RunStatus.COMPLETED,
                    started_at=now - timedelta(minutes=i),
                )
            )
        page1 = catalog.list(limit=5, offset=0)
        page2 = catalog.list(limit=5, offset=5)
        assert len(page1) == 5
        assert len(page2) == 5
        assert page1[0].run_id != page2[0].run_id

    def test_count_runs(self, catalog):
        for i in range(15):
            catalog.insert(
                RunRecord(
                    run_id=f"run-{i}",
                    graph_id="graph-1",
                    graph_name="Test",
                    status=RunStatus.COMPLETED,
                    started_at=datetime.now(timezone.utc),
                )
            )
        assert catalog.count() == 15
        assert catalog.count(RunFilter(status=RunStatus.FAILED)) == 0

    def test_delete_old_runs(self, catalog):
        now = datetime.now(timezone.utc)
        for i in range(10):
            catalog.insert(
                RunRecord(
                    run_id=f"run-{i}",
                    graph_id="graph-1",
                    graph_name="Test",
                    status=RunStatus.COMPLETED,
                    started_at=now - timedelta(days=i),
                )
            )
        # delete_before uses started_at < cutoff; run at exactly now-5d is not removed
        deleted = catalog.delete_before(now - timedelta(days=5))
        assert deleted == 4
        assert catalog.count() == 6
