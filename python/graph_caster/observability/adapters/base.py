# Copyright GraphCaster. All Rights Reserved.

"""Abstract base class for all external trace adapters."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import ClassVar


class TraceAdapter(ABC):
    """Common contract every trace backend adapter must implement.

    Lifecycle order per run:
        on_run_started -> on_node_started* -> on_node_finished* -> on_run_finished -> flush
    """

    name: ClassVar[str]

    @abstractmethod
    def on_run_started(self, run_id: str, graph_id: str, metadata: dict) -> None:
        """Called when a graph run begins."""

    @abstractmethod
    def on_node_started(self, run_id: str, node_id: str, node_type: str, inputs: dict) -> None:
        """Called when a node begins execution."""

    @abstractmethod
    def on_node_finished(
        self,
        run_id: str,
        node_id: str,
        outputs: dict,
        error: dict | None,
        usage: dict | None,
    ) -> None:
        """Called when a node finishes (success or error)."""

    @abstractmethod
    def on_run_finished(self, run_id: str, status: str, summary: dict) -> None:
        """Called when the graph run terminates."""

    @abstractmethod
    async def flush(self) -> None:
        """Flush any pending events to the backend. Must be idempotent."""
