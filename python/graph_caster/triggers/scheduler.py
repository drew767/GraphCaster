# Copyright Aura. All Rights Reserved.

"""Cron-based scheduler for graph execution.

This module provides GraphCronScheduler which manages scheduled graph
executions based on cron expressions. Pattern inspired by n8n's scheduling
system.

Requires the optional `croniter` package for cron parsing.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Awaitable, Callable

try:
    from zoneinfo import ZoneInfo
except ImportError:
    from backports.zoneinfo import ZoneInfo  # type: ignore[import-not-found,no-redef]

logger = logging.getLogger(__name__)

try:
    from croniter import croniter
except ImportError:
    croniter = None  # type: ignore[assignment,misc]


@dataclass
class ScheduleConfig:
    """Configuration for a scheduled graph.

    Attributes:
        graph_id: Unique identifier of the graph to execute.
        cron_expression: Standard cron expression (5 or 6 fields).
        timezone: IANA timezone name for schedule evaluation.
        enabled: Whether this schedule is active.
    """

    graph_id: str
    cron_expression: str
    timezone: str = "UTC"
    enabled: bool = True


class GraphCronScheduler:
    """Cron-based scheduler for graph execution.

    Manages multiple scheduled graphs, each with its own cron expression
    and timezone. Uses asyncio for non-blocking sleep between executions.

    Pattern inspired by n8n's scheduling system.

    Requires croniter package for cron parsing:
        pip install croniter

    Example:
        async def run_graph(graph_id: str, ctx: dict) -> None:
            print(f"Running {graph_id} at {ctx['scheduled_time']}")

        scheduler = GraphCronScheduler(run_callback=run_graph)
        scheduler.register(ScheduleConfig(
            graph_id="daily-report",
            cron_expression="0 9 * * *",
            timezone="America/New_York",
        ))
        await scheduler.start()
    """

    def __init__(
        self,
        run_callback: Callable[[str, dict[str, Any]], Awaitable[Any]],
    ) -> None:
        """Initialize the scheduler.

        Args:
            run_callback: Async function called when a graph should be executed.
                Receives (graph_id, trigger_context) arguments.
        """
        self._run_callback = run_callback
        self._schedules: dict[str, ScheduleConfig] = {}
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._running = False

    async def start(self) -> None:
        """Start the scheduler.

        Begins monitoring all registered and enabled schedules.
        Idempotent - calling multiple times has no effect.
        """
        if self._running:
            return
        self._running = True
        for graph_id in list(self._schedules.keys()):
            self._start_schedule(graph_id)
        logger.info("Scheduler started with %d schedules", len(self._schedules))

    async def stop(self) -> None:
        """Stop the scheduler and all running tasks.

        Cancels all schedule loops and clears task registry.
        """
        self._running = False
        for task in list(self._tasks.values()):
            task.cancel()
        self._tasks.clear()
        logger.info("Scheduler stopped")

    def register(self, config: ScheduleConfig) -> None:
        """Register a graph for scheduled execution.

        Args:
            config: Schedule configuration including cron expression.

        Raises:
            RuntimeError: If croniter package is not installed.
            ValueError: If cron expression is invalid.
        """
        if croniter is None:
            raise RuntimeError("croniter package required for scheduling")
        croniter(config.cron_expression)
        self._schedules[config.graph_id] = config
        if self._running and config.enabled:
            self._start_schedule(config.graph_id)

    def unregister(self, graph_id: str) -> None:
        """Unregister a graph from scheduling.

        Safe to call for non-existent graph IDs.

        Args:
            graph_id: ID of the graph to unregister.
        """
        if graph_id in self._tasks:
            self._tasks[graph_id].cancel()
            del self._tasks[graph_id]
        self._schedules.pop(graph_id, None)

    def _start_schedule(self, graph_id: str) -> None:
        """Start the schedule loop for a graph.

        Args:
            graph_id: ID of the graph to start scheduling.
        """
        config = self._schedules.get(graph_id)
        if not config or not config.enabled:
            return
        task = asyncio.create_task(self._schedule_loop(config))
        self._tasks[graph_id] = task

    async def _schedule_loop(self, config: ScheduleConfig) -> None:
        """Run the schedule loop for a graph.

        Continuously calculates next run time and waits for it,
        then invokes the run callback.

        Args:
            config: Schedule configuration.
        """
        tz = ZoneInfo(config.timezone)
        cron = croniter(config.cron_expression, datetime.now(tz))

        while self._running:
            next_run = cron.get_next(datetime)
            delay = (next_run - datetime.now(tz)).total_seconds()
            if delay > 0:
                try:
                    await asyncio.sleep(delay)
                except asyncio.CancelledError:
                    break

            if not self._running:
                break

            try:
                trigger_ctx = {
                    "type": "schedule",
                    "graph_id": config.graph_id,
                    "scheduled_time": next_run.isoformat(),
                    "cron_expression": config.cron_expression,
                }
                await self._run_callback(config.graph_id, trigger_ctx)
            except Exception as e:
                logger.error("Scheduled run failed for %s: %s", config.graph_id, e)
