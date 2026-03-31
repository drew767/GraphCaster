# Copyright Aura. All Rights Reserved.

"""Tests for schedule trigger node and scheduler."""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import AsyncMock

import pytest

# Check if croniter is available
try:
    from croniter import croniter as _croniter_check
    CRONITER_AVAILABLE = True
except ImportError:
    CRONITER_AVAILABLE = False

pytestmark = pytest.mark.skipif(
    not CRONITER_AVAILABLE,
    reason="croniter package not installed",
)


class TestScheduleConfig:
    """Tests for ScheduleConfig dataclass."""

    def test_config_default_values(self) -> None:
        from graph_caster.triggers.scheduler import ScheduleConfig

        config = ScheduleConfig(
            graph_id="graph-1",
            cron_expression="0 * * * *",
        )
        assert config.graph_id == "graph-1"
        assert config.cron_expression == "0 * * * *"
        assert config.timezone == "UTC"
        assert config.enabled is True

    def test_config_with_all_values(self) -> None:
        from graph_caster.triggers.scheduler import ScheduleConfig

        config = ScheduleConfig(
            graph_id="graph-2",
            cron_expression="*/5 * * * *",
            timezone="America/New_York",
            enabled=False,
        )
        assert config.graph_id == "graph-2"
        assert config.cron_expression == "*/5 * * * *"
        assert config.timezone == "America/New_York"
        assert config.enabled is False


class TestGraphCronScheduler:
    """Tests for GraphCronScheduler."""

    def test_register_validates_cron_expression(self) -> None:
        from graph_caster.triggers.scheduler import GraphCronScheduler, ScheduleConfig

        callback = AsyncMock()
        scheduler = GraphCronScheduler(run_callback=callback)

        valid_config = ScheduleConfig(
            graph_id="graph-1",
            cron_expression="0 * * * *",
        )
        scheduler.register(valid_config)
        assert "graph-1" in scheduler._schedules

    def test_register_rejects_invalid_cron_expression(self) -> None:
        from graph_caster.triggers.scheduler import GraphCronScheduler, ScheduleConfig

        callback = AsyncMock()
        scheduler = GraphCronScheduler(run_callback=callback)

        invalid_config = ScheduleConfig(
            graph_id="graph-bad",
            cron_expression="not-a-cron",
        )
        with pytest.raises(Exception):
            scheduler.register(invalid_config)

    def test_register_unregister_works(self) -> None:
        from graph_caster.triggers.scheduler import GraphCronScheduler, ScheduleConfig

        callback = AsyncMock()
        scheduler = GraphCronScheduler(run_callback=callback)

        config = ScheduleConfig(
            graph_id="graph-1",
            cron_expression="0 * * * *",
        )
        scheduler.register(config)
        assert "graph-1" in scheduler._schedules

        scheduler.unregister("graph-1")
        assert "graph-1" not in scheduler._schedules

    def test_unregister_nonexistent_is_safe(self) -> None:
        from graph_caster.triggers.scheduler import GraphCronScheduler

        callback = AsyncMock()
        scheduler = GraphCronScheduler(run_callback=callback)

        scheduler.unregister("nonexistent")

    @pytest.mark.anyio
    async def test_start_stop_lifecycle(self) -> None:
        from graph_caster.triggers.scheduler import GraphCronScheduler, ScheduleConfig

        callback = AsyncMock()
        scheduler = GraphCronScheduler(run_callback=callback)

        config = ScheduleConfig(
            graph_id="graph-1",
            cron_expression="0 * * * *",
        )
        scheduler.register(config)

        await scheduler.start()
        assert scheduler._running is True
        assert "graph-1" in scheduler._tasks

        await scheduler.stop()
        assert scheduler._running is False
        assert len(scheduler._tasks) == 0

    @pytest.mark.anyio
    async def test_start_is_idempotent(self) -> None:
        from graph_caster.triggers.scheduler import GraphCronScheduler

        callback = AsyncMock()
        scheduler = GraphCronScheduler(run_callback=callback)

        await scheduler.start()
        await scheduler.start()
        assert scheduler._running is True

        await scheduler.stop()

    @pytest.mark.anyio
    async def test_disabled_schedule_not_started(self) -> None:
        from graph_caster.triggers.scheduler import GraphCronScheduler, ScheduleConfig

        callback = AsyncMock()
        scheduler = GraphCronScheduler(run_callback=callback)

        config = ScheduleConfig(
            graph_id="graph-disabled",
            cron_expression="0 * * * *",
            enabled=False,
        )
        scheduler.register(config)

        await scheduler.start()
        assert "graph-disabled" not in scheduler._tasks

        await scheduler.stop()


class TestScheduleNodeConfig:
    """Tests for ScheduleNodeConfig dataclass."""

    def test_config_default_values(self) -> None:
        from graph_caster.nodes.trigger_schedule import ScheduleNodeConfig

        config = ScheduleNodeConfig(cron_expression="0 * * * *")
        assert config.cron_expression == "0 * * * *"
        assert config.timezone == "UTC"
        assert config.enabled is True

    def test_config_with_all_values(self) -> None:
        from graph_caster.nodes.trigger_schedule import ScheduleNodeConfig

        config = ScheduleNodeConfig(
            cron_expression="*/15 * * * *",
            timezone="Europe/London",
            enabled=False,
        )
        assert config.cron_expression == "*/15 * * * *"
        assert config.timezone == "Europe/London"
        assert config.enabled is False


class TestTriggerScheduleNode:
    """Tests for TriggerScheduleNode."""

    def test_node_type_is_trigger_schedule(self) -> None:
        from graph_caster.nodes.trigger_schedule import TriggerScheduleNode

        assert TriggerScheduleNode.node_type == "trigger_schedule"

    def test_node_initialization(self) -> None:
        from graph_caster.nodes.trigger_schedule import TriggerScheduleNode

        node = TriggerScheduleNode(
            node_id="node-1",
            config={"cron_expression": "0 9 * * *"},
        )
        assert node.id == "node-1"
        assert node.config.cron_expression == "0 9 * * *"
        assert node.config.timezone == "UTC"

    def test_validate_valid_cron_expression(self) -> None:
        from graph_caster.nodes.trigger_schedule import TriggerScheduleNode

        node = TriggerScheduleNode(
            node_id="node-2",
            config={"cron_expression": "*/5 * * * *"},
        )
        node.validate()

    def test_validate_catches_invalid_cron(self) -> None:
        from graph_caster.nodes.trigger_schedule import TriggerScheduleNode

        node = TriggerScheduleNode(
            node_id="node-3",
            config={"cron_expression": "invalid-cron-expression"},
        )
        with pytest.raises(ValueError, match="Invalid cron expression"):
            node.validate()

    @pytest.mark.anyio
    async def test_execute_extracts_schedule_info(self) -> None:
        from graph_caster.nodes.trigger_schedule import TriggerScheduleNode

        node = TriggerScheduleNode(
            node_id="node-4",
            config={
                "cron_expression": "0 9 * * 1-5",
                "timezone": "America/Los_Angeles",
            },
        )

        trigger_context = {
            "type": "schedule",
            "graph_id": "graph-123",
            "scheduled_time": "2026-03-31T09:00:00-07:00",
            "cron_expression": "0 9 * * 1-5",
        }

        result = await node.execute(trigger_context)

        assert result["scheduled_time"] == "2026-03-31T09:00:00-07:00"
        assert result["cron_expression"] == "0 9 * * 1-5"
        assert result["timezone"] == "America/Los_Angeles"

    @pytest.mark.anyio
    async def test_execute_handles_missing_scheduled_time(self) -> None:
        from graph_caster.nodes.trigger_schedule import TriggerScheduleNode

        node = TriggerScheduleNode(
            node_id="node-5",
            config={"cron_expression": "0 * * * *"},
        )

        trigger_context = {"type": "schedule"}

        result = await node.execute(trigger_context)

        assert result["scheduled_time"] is None
        assert result["cron_expression"] == "0 * * * *"
        assert result["timezone"] == "UTC"
