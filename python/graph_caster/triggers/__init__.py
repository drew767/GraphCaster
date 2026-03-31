# Copyright Aura. All Rights Reserved.

"""Trigger types for graph execution entry points."""

from graph_caster.triggers.base import TriggerContext, TriggerType

# Scheduler is optional - requires croniter
try:
    from graph_caster.triggers.scheduler import GraphCronScheduler, ScheduleConfig
except ImportError:
    GraphCronScheduler = None  # type: ignore[assignment,misc]
    ScheduleConfig = None  # type: ignore[assignment,misc]

__all__ = [
    "GraphCronScheduler",
    "ScheduleConfig",
    "TriggerContext",
    "TriggerType",
]
