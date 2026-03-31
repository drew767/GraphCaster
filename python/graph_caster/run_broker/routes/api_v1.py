# Copyright Aura. All Rights Reserved.

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, Protocol

if TYPE_CHECKING:
    from graph_caster.run_broker.auth.api_key import APIKeyAuthenticator

logger = logging.getLogger(__name__)


class RunManagerProtocol(Protocol):
    """Protocol for run manager interface expected by APIV1Handler."""

    async def start_run(
        self,
        graph_id: str,
        context: dict[str, Any] | None = None,
        trigger_context: dict[str, Any] | None = None,
    ) -> str:
        """Start a new run. Returns run_id."""
        ...

    async def wait_for_run(
        self, run_id: str, timeout: float = 300.0
    ) -> dict[str, Any]:
        """Wait for run completion. Returns result dict with status/outputs/error."""
        ...

    async def get_run_status(self, run_id: str) -> dict[str, Any] | None:
        """Get run status. Returns None if not found."""
        ...

    async def cancel_run(self, run_id: str) -> dict[str, Any]:
        """Cancel a run. Returns dict with cancelled bool and optional message."""
        ...

    async def get_run_events_ndjson(
        self, run_id: str, max_bytes: int
    ) -> tuple[str, bool] | None:
        """Return persisted run-event NDJSON (utf-8) and whether the tail cap applied.

        ``None`` means the run id is unknown. Empty string means no persisted events (yet).
        """
        ...


@dataclass
class RunRequest:
    """Request to start a graph run."""

    inputs: dict[str, Any] = field(default_factory=dict)
    wait_for_completion: bool = False
    timeout: float = 300.0


@dataclass
class RunResponse:
    """Response for run operations."""

    run_id: str
    graph_id: str
    status: str
    created_at: str
    outputs: dict[str, Any] | None = None
    error: str | None = None


@dataclass
class CancelResponse:
    """Response for cancel operation."""

    run_id: str
    cancelled: bool
    message: str | None = None


class APIV1Handler:
    """REST API v1 handler for graph operations.

    Endpoints:
      POST /api/v1/graphs/{graphId}/run - Start a run
      GET /api/v1/runs/{runId} - Get run status
      GET /api/v1/runs/{runId}/events - Persisted run-event NDJSON (when artifacts are enabled)
      POST /api/v1/runs/{runId}/cancel - Cancel a run
    """

    def __init__(
        self,
        run_manager: RunManagerProtocol,
        auth: "APIKeyAuthenticator | None" = None,
    ) -> None:
        self._run_manager = run_manager
        self._auth = auth

    def _check_auth(self, auth_header: str | None, required_scope: str) -> None:
        """Check authentication. Raises PermissionError if invalid."""
        if self._auth is None:
            return  # Auth disabled
        key = self._auth.validate(auth_header)
        if key is None:
            raise PermissionError("Invalid API key")
        if not self._auth.has_scope(key, required_scope):
            raise PermissionError(f"Missing scope: {required_scope}")

    async def start_run(
        self,
        graph_id: str,
        request: RunRequest,
        auth_header: str | None = None,
    ) -> RunResponse:
        """Start a new graph run."""
        self._check_auth(auth_header, "run:execute")

        trigger_ctx = {
            "type": "api",
            "graph_id": graph_id,
            "inputs": request.inputs,
        }
        run_id = await self._run_manager.start_run(
            graph_id,
            context=request.inputs,
            trigger_context=trigger_ctx,
        )

        if request.wait_for_completion:
            result = await self._run_manager.wait_for_run(run_id, timeout=request.timeout)
            return RunResponse(
                run_id=run_id,
                graph_id=graph_id,
                status=result.get("status", "unknown"),
                created_at=datetime.now(timezone.utc).isoformat(),
                outputs=result.get("outputs"),
                error=result.get("error"),
            )

        return RunResponse(
            run_id=run_id,
            graph_id=graph_id,
            status="started",
            created_at=datetime.now(timezone.utc).isoformat(),
        )

    async def get_run_status(
        self,
        run_id: str,
        auth_header: str | None = None,
    ) -> RunResponse:
        """Get run status."""
        self._check_auth(auth_header, "run:view")

        status = await self._run_manager.get_run_status(run_id)
        if status is None:
            raise KeyError(f"Run not found: {run_id}")

        return RunResponse(
            run_id=run_id,
            graph_id=status.get("graph_id", ""),
            status=status.get("status", "unknown"),
            created_at=status.get("created_at", ""),
            outputs=status.get("outputs"),
            error=status.get("error"),
        )

    async def get_run_events(
        self,
        run_id: str,
        *,
        max_bytes: int,
        auth_header: str | None = None,
    ) -> tuple[str, bool]:
        """Return persisted NDJSON lines for ``run_id`` (``text``, ``truncated``)."""
        self._check_auth(auth_header, "run:view")

        out = await self._run_manager.get_run_events_ndjson(run_id, max_bytes)
        if out is None:
            raise KeyError(f"Run not found: {run_id}")
        return out

    async def cancel_run(
        self,
        run_id: str,
        auth_header: str | None = None,
    ) -> CancelResponse:
        """Cancel a run."""
        self._check_auth(auth_header, "run:cancel")

        result = await self._run_manager.cancel_run(run_id)
        return CancelResponse(
            run_id=run_id,
            cancelled=result.get("cancelled", False),
            message=result.get("message"),
        )
