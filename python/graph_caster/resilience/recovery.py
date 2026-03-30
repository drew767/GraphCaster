# Copyright GraphCaster. All Rights Reserved.

"""Run state recovery management."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from enum import Enum

from .checkpoint import CheckpointNotFoundError, CheckpointStore, RunCheckpoint

logger = logging.getLogger(__name__)


class RecoveryAction(Enum):
    NONE = "none"
    RESUME = "resume"
    RESTART = "restart"
    ABANDON = "abandon"


@dataclass
class RecoveryResult:
    action: RecoveryAction
    checkpoint: RunCheckpoint | None = None
    reason: str = ""


class RecoveryManager:
    """Manage run recovery from checkpoints."""

    def __init__(self, store: CheckpointStore):
        self.store = store

    def check_recovery(self, run_id: str) -> RecoveryResult:
        try:
            checkpoint = self.store.load(run_id)
        except CheckpointNotFoundError:
            return RecoveryResult(action=RecoveryAction.NONE, reason="No checkpoint found")

        if checkpoint.status == "completed":
            return RecoveryResult(
                action=RecoveryAction.NONE,
                checkpoint=checkpoint,
                reason="Run already completed",
            )
        if checkpoint.status == "failed":
            return RecoveryResult(
                action=RecoveryAction.NONE,
                checkpoint=checkpoint,
                reason="Run already failed",
            )
        if checkpoint.status == "cancelled":
            return RecoveryResult(
                action=RecoveryAction.NONE,
                checkpoint=checkpoint,
                reason="Run was cancelled",
            )
        return RecoveryResult(
            action=RecoveryAction.RESUME,
            checkpoint=checkpoint,
            reason=f"Crashed at node {checkpoint.current_node_id}",
        )

    def prepare_recovery(self, checkpoint: RunCheckpoint) -> dict[str, object]:
        return {
            "run_id": checkpoint.run_id,
            "graph_id": checkpoint.graph_id,
            "resume_from_node": checkpoint.current_node_id,
            "node_outputs": checkpoint.node_outputs.copy(),
            "last_event_index": checkpoint.last_event_index,
            "is_recovery": True,
        }

    def mark_completed(self, run_id: str) -> None:
        try:
            checkpoint = self.store.load(run_id)
            checkpoint.status = "completed"
            self.store.save(checkpoint)
        except CheckpointNotFoundError:
            logger.warning("Cannot mark %s completed: no checkpoint", run_id)

    def mark_failed(self, run_id: str, error: str) -> None:
        try:
            checkpoint = self.store.load(run_id)
            checkpoint.status = "failed"
            checkpoint.error_message = error
            self.store.save(checkpoint)
        except CheckpointNotFoundError:
            logger.warning("Cannot mark %s failed: no checkpoint", run_id)

    def cleanup(self, run_id: str) -> None:
        self.store.delete(run_id)

    def list_recoverable(self) -> list[RunCheckpoint]:
        return self.store.list_active()

    def recover_all(self) -> list[RecoveryResult]:
        return [self.check_recovery(c.run_id) for c in self.store.list_active()]
