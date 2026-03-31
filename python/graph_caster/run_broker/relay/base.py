# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from collections.abc import AsyncIterator


@dataclass
class RelayMessage:
    """Message envelope for cross-instance relay."""

    run_id: str
    channel: Literal["stdout", "stderr", "exit", "control"]
    payload: str  # Raw NDJSON line or control JSON
    instance_id: str = ""
    timestamp: float = field(default_factory=time.time)

    def to_dict(self) -> dict[str, object]:
        return {
            "runId": self.run_id,
            "channel": self.channel,
            "payload": self.payload,
            "instanceId": self.instance_id,
            "timestamp": self.timestamp,
        }

    @classmethod
    def from_dict(cls, data: dict[str, object]) -> RelayMessage:
        return cls(
            run_id=str(data.get("runId", "")),
            channel=data.get("channel", "stdout"),  # type: ignore[arg-type]
            payload=str(data.get("payload", "")),
            instance_id=str(data.get("instanceId", "")),
            timestamp=float(data.get("timestamp", 0.0)),
        )


class EventRelay(ABC):
    """Abstract interface for run event relay."""

    @abstractmethod
    async def connect(self) -> None:
        """Establish connection to the relay backend."""

    @abstractmethod
    async def disconnect(self) -> None:
        """Disconnect from the relay backend."""

    @abstractmethod
    async def publish(self, message: RelayMessage) -> int:
        """Publish a message to subscribers. Returns number of recipients."""

    @abstractmethod
    def subscribe(self, run_id: str) -> AsyncIterator[RelayMessage]:
        """Subscribe to messages for a run. Returns async iterator."""

    @abstractmethod
    async def unsubscribe(self, run_id: str) -> None:
        """Unsubscribe from a run's messages."""

    @property
    @abstractmethod
    def is_distributed(self) -> bool:
        """True if relay spans multiple instances (e.g., Redis)."""
