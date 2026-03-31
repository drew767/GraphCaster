# Copyright Aura. All Rights Reserved.

"""Base trigger types and context for graph execution entry points."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class TriggerType(str, Enum):
    """Types of triggers that can start graph execution."""

    WEBHOOK = "webhook"
    SCHEDULE = "schedule"
    MANUAL = "manual"
    API = "api"


@dataclass
class TriggerContext:
    """Context passed to graph execution from a trigger.

    This context captures how a graph run was initiated and provides
    access to trigger-specific data (e.g., webhook payload, headers).
    """

    trigger_type: TriggerType
    trigger_id: str
    payload: dict[str, Any] = field(default_factory=dict)
    headers: dict[str, str] = field(default_factory=dict)
    timestamp: float = field(default_factory=time.time)

    def to_context_vars(self) -> dict[str, Any]:
        """Convert to variables accessible in graph as $trigger.

        Returns:
            Dictionary with 'trigger' key containing all trigger metadata,
            suitable for injection into graph execution context.
        """
        return {
            "trigger": {
                "type": self.trigger_type.value,
                "id": self.trigger_id,
                "payload": self.payload,
                "headers": self.headers,
                "timestamp": self.timestamp,
            }
        }
