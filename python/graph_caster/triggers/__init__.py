# Copyright Aura. All Rights Reserved.

"""Trigger types for graph execution entry points."""

from graph_caster.triggers.base import TriggerContext, TriggerType
from graph_caster.triggers.builtin_scheduler_policy import is_graph_builtin_scheduler_enabled

# Scheduler is optional - requires croniter
try:
    from graph_caster.triggers.scheduler import GraphCronScheduler, ScheduleConfig
except ImportError:
    GraphCronScheduler = None  # type: ignore[assignment,misc]
    ScheduleConfig = None  # type: ignore[assignment,misc]

__all__ = [
    "GraphCronScheduler",
    "ScheduleConfig",
    "is_graph_builtin_scheduler_enabled",
    "TriggerContext",
    "TriggerType",
]
