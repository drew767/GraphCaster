# Copyright GraphCaster. All Rights Reserved.

"""Tests for run_broker_scheduler (F68 — built-in cron scheduler daemon)."""

from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

try:
    from croniter import croniter as _croniter_check  # noqa: F401
    CRONITER_AVAILABLE = True
except ImportError:
    CRONITER_AVAILABLE = False

pytestmark = pytest.mark.skipif(
    not CRONITER_AVAILABLE,
    reason="croniter package not installed",
)


def _make_graph_doc(
    graph_id: str,
    cron: str,
    node_id: str = "sched1",
    tz: str = "UTC",
    node_type: str = "trigger_schedule",
) -> dict[str, Any]:
    return {
        "graphId": graph_id,
        "nodes": [
            {
                "id": node_id,
                "type": node_type,
                "data": {
                    "cron": cron,
                    "timezone": tz,
                },
            }
        ],
        "edges": [],
    }


def _write_graph(tmp_path: Path, name: str, doc: dict[str, Any]) -> Path:
    p = tmp_path / name
    p.write_text(json.dumps(doc), encoding="utf-8")
    return p


class MockBrokerClient:
    """Simple mock broker client that records start_run calls."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self.raise_on_next: Exception | None = None

    async def start_run(self, graph_id: str, start_node_id: str, source: str = "schedule") -> None:
        if self.raise_on_next is not None:
            exc = self.raise_on_next
            self.raise_on_next = None
            raise exc
        self.calls.append(
            {"graph_id": graph_id, "start_node_id": start_node_id, "source": source}
        )


class TestScheduledJob:
    def test_to_dict_all_fields(self) -> None:
        from graph_caster.run_broker_scheduler import ScheduledJob

        now = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
        job = ScheduledJob(
            graph_id="g1",
            node_id="n1",
            cron="* * * * *",
            timezone="UTC",
            last_fire_at=now,
            next_fire_at=now + timedelta(minutes=1),
            fire_count=3,
            missed_count=1,
        )
        d = job.to_dict()
        assert d["graphId"] == "g1"
        assert d["nodeId"] == "n1"
        assert d["cron"] == "* * * * *"
        assert d["timezone"] == "UTC"
        assert d["fireCount"] == 3
        assert d["missedCount"] == 1
        assert d["lastFireAt"] is not None
        assert d["nextFireAt"] is not None

    def test_to_dict_no_last_fire(self) -> None:
        from graph_caster.run_broker_scheduler import ScheduledJob

        now = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
        job = ScheduledJob(graph_id="g1", node_id="n1", cron="* * * * *", next_fire_at=now)
        d = job.to_dict()
        assert d["lastFireAt"] is None


class TestParseScheduleNodes:
    def test_parses_trigger_schedule_node(self) -> None:
        from graph_caster.run_broker_scheduler import _parse_trigger_schedule_nodes

        doc = _make_graph_doc("graph-1", "0 * * * *")
        result = _parse_trigger_schedule_nodes(doc)
        assert len(result) == 1
        gid, nid, cron, tz = result[0]
        assert gid == "graph-1"
        assert nid == "sched1"
        assert cron == "0 * * * *"
        assert tz == "UTC"

    def test_skips_non_trigger_schedule_nodes(self) -> None:
        from graph_caster.run_broker_scheduler import _parse_trigger_schedule_nodes

        doc = _make_graph_doc("g1", "* * * * *", node_type="task")
        result = _parse_trigger_schedule_nodes(doc)
        assert result == []

    def test_reads_cronExpression_alias(self) -> None:
        from graph_caster.run_broker_scheduler import _parse_trigger_schedule_nodes

        doc = {
            "graphId": "g-alias",
            "nodes": [
                {
                    "id": "n1",
                    "type": "trigger_schedule",
                    "data": {"cronExpression": "5 4 * * *"},
                }
            ],
        }
        result = _parse_trigger_schedule_nodes(doc)
        assert result[0][2] == "5 4 * * *"

    def test_defaults_timezone_utc(self) -> None:
        from graph_caster.run_broker_scheduler import _parse_trigger_schedule_nodes

        doc = {
            "graphId": "g-tz",
            "nodes": [{"id": "n1", "type": "trigger_schedule", "data": {"cron": "* * * * *"}}],
        }
        result = _parse_trigger_schedule_nodes(doc)
        assert result[0][3] == "UTC"

    def test_empty_graph(self) -> None:
        from graph_caster.run_broker_scheduler import _parse_trigger_schedule_nodes

        result = _parse_trigger_schedule_nodes({"graphId": "g1", "nodes": []})
        assert result == []


class TestSchedulerLoad:
    """Tests for Scheduler.reload() — graph discovery from disk."""

    @pytest.mark.anyio
    async def test_reload_loads_job_from_file(self, tmp_path: Path) -> None:
        from graph_caster.run_broker_scheduler import Scheduler

        doc = _make_graph_doc("graph-1", "* * * * *")
        _write_graph(tmp_path, "graph-1.json", doc)

        client = MockBrokerClient()
        sch = Scheduler(tmp_path, client)
        await sch.reload()
        jobs = sch.list_jobs()
        assert len(jobs) == 1
        assert jobs[0].graph_id == "graph-1"
        assert jobs[0].node_id == "sched1"
        assert jobs[0].cron == "* * * * *"

    @pytest.mark.anyio
    async def test_reload_after_new_graph_added(self, tmp_path: Path) -> None:
        from graph_caster.run_broker_scheduler import Scheduler

        client = MockBrokerClient()
        sch = Scheduler(tmp_path, client)
        await sch.reload()
        assert len(sch.list_jobs()) == 0

        doc = _make_graph_doc("graph-2", "0 12 * * *")
        _write_graph(tmp_path, "graph-2.json", doc)
        await sch.reload()
        jobs = sch.list_jobs()
        assert len(jobs) == 1
        assert jobs[0].graph_id == "graph-2"

    @pytest.mark.anyio
    async def test_reload_invalid_cron_skipped_no_crash(self, tmp_path: Path) -> None:
        from graph_caster.run_broker_scheduler import Scheduler

        doc = _make_graph_doc("graph-bad", "NOT_A_CRON_EXPRESSION")
        _write_graph(tmp_path, "bad.json", doc)

        valid_doc = _make_graph_doc("graph-ok", "* * * * *")
        _write_graph(tmp_path, "ok.json", valid_doc)

        client = MockBrokerClient()
        sch = Scheduler(tmp_path, client)
        await sch.reload()
        jobs = sch.list_jobs()
        assert len(jobs) == 1
        assert jobs[0].graph_id == "graph-ok"

    @pytest.mark.anyio
    async def test_reload_bad_json_skipped_no_crash(self, tmp_path: Path) -> None:
        from graph_caster.run_broker_scheduler import Scheduler

        (tmp_path / "broken.json").write_text("NOT JSON {{{{", encoding="utf-8")
        valid_doc = _make_graph_doc("graph-ok", "* * * * *")
        _write_graph(tmp_path, "ok.json", valid_doc)

        client = MockBrokerClient()
        sch = Scheduler(tmp_path, client)
        await sch.reload()
        assert len(sch.list_jobs()) == 1

    @pytest.mark.anyio
    async def test_reload_missing_graph_id_skipped(self, tmp_path: Path) -> None:
        from graph_caster.run_broker_scheduler import Scheduler

        doc = {
            "nodes": [{"id": "n1", "type": "trigger_schedule", "data": {"cron": "* * * * *"}}]
        }
        _write_graph(tmp_path, "no-id.json", doc)

        client = MockBrokerClient()
        sch = Scheduler(tmp_path, client)
        await sch.reload()
        assert len(sch.list_jobs()) == 0

    @pytest.mark.anyio
    async def test_reload_preserves_existing_job_state(self, tmp_path: Path) -> None:
        from graph_caster.run_broker_scheduler import Scheduler

        doc = _make_graph_doc("graph-1", "* * * * *")
        _write_graph(tmp_path, "graph-1.json", doc)

        client = MockBrokerClient()
        sch = Scheduler(tmp_path, client)
        await sch.reload()

        job = sch.list_jobs()[0]
        original_next = job.next_fire_at
        job.fire_count = 5

        await sch.reload()

        reloaded = sch.list_jobs()[0]
        assert reloaded.fire_count == 5
        assert reloaded.next_fire_at == original_next

    @pytest.mark.anyio
    async def test_reload_removes_deleted_graph(self, tmp_path: Path) -> None:
        from graph_caster.run_broker_scheduler import Scheduler

        doc = _make_graph_doc("graph-1", "* * * * *")
        path = _write_graph(tmp_path, "graph-1.json", doc)

        client = MockBrokerClient()
        sch = Scheduler(tmp_path, client)
        await sch.reload()
        assert len(sch.list_jobs()) == 1

        path.unlink()
        await sch.reload()
        assert len(sch.list_jobs()) == 0


class TestSchedulerFiring:
    """Tests for the tick mechanism — jobs fire when now >= next_fire_at."""

    @pytest.mark.anyio
    async def test_tick_fires_due_job(self, tmp_path: Path) -> None:
        from graph_caster.run_broker_scheduler import Scheduler, ScheduledJob

        client = MockBrokerClient()
        past = datetime(2026, 1, 1, 11, 59, 0, tzinfo=timezone.utc)
        now = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)

        sch = Scheduler(tmp_path, client, clock=lambda: now)
        job = ScheduledJob(
            graph_id="g1",
            node_id="n1",
            cron="* * * * *",
            next_fire_at=past,
        )
        sch._jobs["g1::n1"] = job

        await sch._tick_once()

        assert len(client.calls) == 1
        assert client.calls[0]["graph_id"] == "g1"
        assert client.calls[0]["start_node_id"] == "n1"
        assert client.calls[0]["source"] == "schedule"

    @pytest.mark.anyio
    async def test_tick_does_not_fire_future_job(self, tmp_path: Path) -> None:
        from graph_caster.run_broker_scheduler import Scheduler, ScheduledJob

        client = MockBrokerClient()
        future = datetime(2026, 1, 1, 13, 0, 0, tzinfo=timezone.utc)
        now = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)

        sch = Scheduler(tmp_path, client, clock=lambda: now)
        job = ScheduledJob(
            graph_id="g1",
            node_id="n1",
            cron="* * * * *",
            next_fire_at=future,
        )
        sch._jobs["g1::n1"] = job

        await sch._tick_once()
        assert len(client.calls) == 0

    @pytest.mark.anyio
    async def test_tick_updates_last_fire_and_next_fire(self, tmp_path: Path) -> None:
        from graph_caster.run_broker_scheduler import Scheduler, ScheduledJob

        client = MockBrokerClient()
        past = datetime(2026, 1, 1, 11, 59, 0, tzinfo=timezone.utc)
        now = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)

        sch = Scheduler(tmp_path, client, clock=lambda: now)
        job = ScheduledJob(
            graph_id="g1",
            node_id="n1",
            cron="* * * * *",
            next_fire_at=past,
        )
        sch._jobs["g1::n1"] = job

        await sch._tick_once()

        assert job.last_fire_at == now
        assert job.next_fire_at > now
        assert job.fire_count == 1

    @pytest.mark.anyio
    async def test_tick_missed_fire_counted_on_start_run_failure(self, tmp_path: Path) -> None:
        from graph_caster.run_broker_scheduler import Scheduler, ScheduledJob

        client = MockBrokerClient()
        client.raise_on_next = RuntimeError("broker queue full")

        past = datetime(2026, 1, 1, 11, 59, 0, tzinfo=timezone.utc)
        now = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)

        sch = Scheduler(tmp_path, client, clock=lambda: now)
        job = ScheduledJob(
            graph_id="g1",
            node_id="n1",
            cron="* * * * *",
            next_fire_at=past,
        )
        sch._jobs["g1::n1"] = job

        await sch._tick_once()

        assert job.missed_count == 1
        assert job.fire_count == 0
        assert len(client.calls) == 0

    @pytest.mark.anyio
    async def test_bad_job_does_not_crash_loop(self, tmp_path: Path) -> None:
        from graph_caster.run_broker_scheduler import Scheduler, ScheduledJob

        client = MockBrokerClient()
        client.raise_on_next = Exception("boom")

        past = datetime(2026, 1, 1, 11, 59, 0, tzinfo=timezone.utc)
        now = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)

        sch = Scheduler(tmp_path, client, clock=lambda: now)

        job_bad = ScheduledJob(graph_id="bad", node_id="nb", cron="* * * * *", next_fire_at=past)
        job_good = ScheduledJob(graph_id="good", node_id="ng", cron="* * * * *", next_fire_at=past)
        sch._jobs["bad::nb"] = job_bad
        sch._jobs["good::ng"] = job_good

        await sch._tick_once()

        assert any(c["graph_id"] == "good" for c in client.calls), "Good job should still fire"

    @pytest.mark.anyio
    async def test_minute_boundary_fires_once_per_minute(self, tmp_path: Path) -> None:
        """Simulate two ticks across a minute boundary; assert exactly one fire."""
        from graph_caster.run_broker_scheduler import Scheduler, ScheduledJob

        client = MockBrokerClient()

        t0 = datetime(2026, 1, 1, 12, 0, 30, tzinfo=timezone.utc)
        t1 = datetime(2026, 1, 1, 12, 1, 0, tzinfo=timezone.utc)
        t2 = datetime(2026, 1, 1, 12, 1, 30, tzinfo=timezone.utc)

        clock_val = [t0]
        sch = Scheduler(tmp_path, client, clock=lambda: clock_val[0])

        fire_at = t1
        job = ScheduledJob(graph_id="g1", node_id="n1", cron="* * * * *", next_fire_at=fire_at)
        sch._jobs["g1::n1"] = job

        clock_val[0] = t0
        await sch._tick_once()
        assert len(client.calls) == 0

        clock_val[0] = t1
        await sch._tick_once()
        assert len(client.calls) == 1

        clock_val[0] = t2
        await sch._tick_once()
        assert len(client.calls) == 1


class TestSchedulerRunLoop:
    """Integration-level tests for Scheduler.run()."""

    @pytest.mark.anyio
    async def test_run_disabled_by_default(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        from graph_caster.run_broker_scheduler import Scheduler

        monkeypatch.delenv("GC_RUN_BROKER_SCHEDULER", raising=False)
        client = MockBrokerClient()
        sch = Scheduler(tmp_path, client, tick_interval_sec=0.01)

        doc = _make_graph_doc("graph-1", "* * * * *")
        _write_graph(tmp_path, "graph-1.json", doc)

        await sch.run()
        assert not sch._running
        assert len(client.calls) == 0

    @pytest.mark.anyio
    async def test_run_enabled_fires_and_stops(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from graph_caster.run_broker_scheduler import Scheduler

        monkeypatch.setenv("GC_RUN_BROKER_SCHEDULER", "on")

        doc = _make_graph_doc("g1", "* * * * *")
        _write_graph(tmp_path, "g1.json", doc)

        call_count = [0]

        class _Client:
            async def start_run(
                self, graph_id: str, start_node_id: str, source: str = "schedule"
            ) -> None:
                call_count[0] += 1

        client = _Client()

        t_base = datetime(2026, 1, 1, 11, 59, 30, tzinfo=timezone.utc)
        t_next = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)

        clock_calls = [0]

        def clock_fn() -> datetime:
            clock_calls[0] += 1
            if clock_calls[0] <= 1:
                return t_base
            return t_next

        sch = Scheduler(tmp_path, client, tick_interval_sec=0.01, clock=clock_fn)

        import anyio

        async def stop_after_short_delay() -> None:
            await anyio.sleep(0.15)
            sch.stop()

        async with anyio.create_task_group() as tg:
            tg.start_soon(sch.run)
            tg.start_soon(stop_after_short_delay)

        assert call_count[0] >= 1


class TestSchedulesRoute:
    """Tests for GET /api/v1/triggers/schedules endpoint."""

    @pytest.mark.anyio
    async def test_schedules_route_no_scheduler(self) -> None:
        from starlette.testclient import TestClient
        from graph_caster.run_broker.routes.assembly import build_run_broker_routes
        from graph_caster.run_broker.idempotency import IdempotencyCache
        from graph_caster.run_broker.registry import RunBrokerRegistry
        from starlette.applications import Starlette

        reg = RunBrokerRegistry()
        cache = IdempotencyCache()
        routes = build_run_broker_routes(reg, cache, scheduler=None)
        app = Starlette(routes=routes)

        with TestClient(app) as client:
            resp = client.get("/api/v1/triggers/schedules")
        assert resp.status_code == 200
        data = resp.json()
        assert data["enabled"] is False
        assert data["items"] == []

    @pytest.mark.anyio
    async def test_schedules_route_with_scheduler(self, tmp_path: Path) -> None:
        from starlette.testclient import TestClient
        from graph_caster.run_broker.routes.assembly import build_run_broker_routes
        from graph_caster.run_broker.idempotency import IdempotencyCache
        from graph_caster.run_broker.registry import RunBrokerRegistry
        from graph_caster.run_broker_scheduler import Scheduler, ScheduledJob
        from starlette.applications import Starlette

        broker_client = MockBrokerClient()
        now = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
        sch = Scheduler(tmp_path, broker_client, clock=lambda: now)

        job = ScheduledJob(
            graph_id="g1",
            node_id="n1",
            cron="* * * * *",
            timezone="UTC",
            next_fire_at=now + timedelta(minutes=1),
        )
        sch._jobs["g1::n1"] = job

        reg = RunBrokerRegistry()
        cache = IdempotencyCache()
        routes = build_run_broker_routes(reg, cache, scheduler=sch)
        app = Starlette(routes=routes)

        with TestClient(app) as client:
            resp = client.get("/api/v1/triggers/schedules")
        assert resp.status_code == 200
        data = resp.json()
        assert data["enabled"] is True
        items = data["items"]
        assert len(items) == 1
        assert items[0]["graphId"] == "g1"
        assert items[0]["nodeId"] == "n1"
        assert items[0]["cron"] == "* * * * *"


class TestPrometheusMetrics:
    def test_metrics_text_empty(self, tmp_path: Path) -> None:
        from graph_caster.run_broker_scheduler import Scheduler

        client = MockBrokerClient()
        sch = Scheduler(tmp_path, client)
        text = sch.prometheus_metrics_text()
        assert "gc_scheduler_jobs_total 0" in text

    def test_metrics_text_with_jobs(self, tmp_path: Path) -> None:
        from graph_caster.run_broker_scheduler import Scheduler, ScheduledJob

        client = MockBrokerClient()
        now = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
        sch = Scheduler(tmp_path, client)

        job = ScheduledJob(
            graph_id="g1",
            node_id="n1",
            cron="* * * * *",
            next_fire_at=now,
            fire_count=7,
            missed_count=2,
        )
        sch._jobs["g1::n1"] = job

        text = sch.prometheus_metrics_text()
        assert "gc_scheduler_jobs_total 1" in text
        assert 'gc_scheduler_fires_total{graphId="g1",nodeId="n1"} 7' in text
        assert 'gc_scheduler_missed_fires_total{graphId="g1"} 2' in text
