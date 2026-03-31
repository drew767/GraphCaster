# Copyright Aura. All Rights Reserved.

"""Schedule trigger node for graph execution entry points.

This module provides the TriggerScheduleNode which serves as an entry point
for graphs triggered by cron-based scheduling. Similar to n8n's Schedule
Trigger node pattern.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any


def schedule_node_config_from_data(data: Mapping[str, Any] | None) -> dict[str, Any]:
    d = dict(data or {})
    cron = d.get("cron_expression", d.get("cronExpression", ""))
    tz = d.get("timezone", d.get("timeZone", "UTC"))
    en = d.get("enabled", True)
    return {
        "cron_expression": str(cron or "").strip(),
        "timezone": str(tz or "UTC").strip() or "UTC",
        "enabled": bool(en) if en is not None else True,
    }


@dataclass
class ScheduleNodeConfig:
    """Configuration for a schedule trigger node.

    Attributes:
        cron_expression: Standard cron expression (5 or 6 fields).
        timezone: IANA timezone name for schedule evaluation.
        enabled: Whether this schedule trigger is active.
    """

    cron_expression: str
    timezone: str = "UTC"
    enabled: bool = True


class TriggerScheduleNode:
    """Schedule trigger node - graph entry point for cron-based execution.

    This node serves as the starting point for graphs that are triggered
    by scheduled cron jobs. It extracts schedule information from the
    incoming trigger context.

    Pattern: Similar to n8n's Schedule Trigger node.

    Attributes:
        node_type: Static identifier for this node type.
        id: Unique identifier for this node instance.
        config: Configuration for schedule behavior.
    """

    node_type = "trigger_schedule"

    def __init__(self, node_id: str, config: dict[str, Any]) -> None:
        """Initialize schedule trigger node.

        Args:
            node_id: Unique identifier for this node instance.
            config: Configuration dictionary matching ScheduleNodeConfig fields.
        """
        self.id = node_id
        self.config = ScheduleNodeConfig(**config)

    def validate(self) -> None:
        """Validate node configuration.

        Verifies that the cron expression is valid by attempting to parse it
        with croniter.

        Raises:
            ValueError: If cron expression is invalid.
        """
        try:
            from croniter import croniter

            croniter(self.config.cron_expression)
        except ImportError as e:
            raise ValueError(
                f"Invalid cron expression: croniter package required for validation"
            ) from e
        except Exception as e:
            raise ValueError(f"Invalid cron expression: {e}") from e

    async def execute(self, trigger_context: dict[str, Any]) -> dict[str, Any]:
        """Extract schedule info from trigger context.

        Args:
            trigger_context: Context dictionary from the schedule trigger,
                containing type, scheduled_time, and cron_expression.

        Returns:
            Dictionary with extracted schedule data:
            - scheduled_time: ISO timestamp of when this execution was scheduled
            - cron_expression: The cron expression from node config
            - timezone: Configured timezone
        """
        return self._extract_schedule_output(trigger_context)

    def _extract_schedule_output(self, trigger_context: Mapping[str, Any]) -> dict[str, Any]:
        return {
            "scheduled_time": trigger_context.get("scheduled_time"),
            "cron_expression": self.config.cron_expression,
            "timezone": self.config.timezone,
        }

    def execute_sync(self, trigger_context: dict[str, Any]) -> dict[str, Any]:
        """Synchronous visit body for `GraphRunner` (no event loop)."""
        return self._extract_schedule_output(trigger_context)
