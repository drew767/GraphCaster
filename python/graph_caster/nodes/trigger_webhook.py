# Copyright Aura. All Rights Reserved.

"""Webhook trigger node for graph execution entry points.

This module provides the TriggerWebhookNode which serves as an entry point
for graphs triggered by HTTP webhooks. Similar to n8n's Webhook node pattern.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Literal


def webhook_node_config_from_data(data: Mapping[str, Any] | None) -> dict[str, Any]:
    """Build constructor kwargs for `WebhookNodeConfig` from graph node `data` (snake_case or camelCase)."""
    d = dict(data or {})
    path_raw = d.get("path", "/hook")
    path = str(path_raw).strip() if path_raw is not None else "/hook"
    method = d.get("method", "POST")
    auth = d.get("auth", "none")
    secret = d.get("secret")
    rm_raw = d.get("response_mode", d.get("responseMode", "immediate"))
    rm = str(rm_raw).strip().lower() if rm_raw is not None else "immediate"
    if rm == "lastnode":
        rm = "wait"
    if rm not in ("immediate", "wait"):
        rm = "immediate"
    return {
        "path": path if path else "/hook",
        "method": method,
        "auth": auth,
        "secret": secret,
        "response_mode": rm,
    }


@dataclass
class WebhookNodeConfig:
    """Configuration for a webhook trigger node.

    Attributes:
        path: URL path for the webhook endpoint (must start with '/').
        method: HTTP method to accept (GET, POST, PUT, DELETE).
        auth: Authentication mode for incoming requests.
        secret: Secret for authentication (required for non-'none' auth modes).
        response_mode: Whether to respond immediately or wait for graph completion.
    """

    path: str
    method: Literal["GET", "POST", "PUT", "DELETE"] = "POST"
    auth: Literal["none", "basic", "bearer", "api_key"] = "none"
    secret: str | None = None
    response_mode: Literal["immediate", "wait"] = "immediate"


class TriggerWebhookNode:
    """Webhook trigger node - graph entry point for HTTP webhooks.

    This node serves as the starting point for graphs that are triggered
    by external HTTP webhook requests. It extracts payload, headers, and
    query parameters from the incoming request context.

    Pattern: Similar to n8n's Webhook node.

    Attributes:
        node_type: Static identifier for this node type.
        id: Unique identifier for this node instance.
        config: Configuration for webhook behavior.
    """

    node_type = "trigger_webhook"

    def __init__(self, node_id: str, config: dict[str, Any]) -> None:
        """Initialize webhook trigger node.

        Args:
            node_id: Unique identifier for this node instance.
            config: Configuration dictionary matching WebhookNodeConfig fields.
        """
        self.id = node_id
        self.config = WebhookNodeConfig(**config)

    def validate(self) -> None:
        """Validate node configuration.

        Raises:
            ValueError: If path doesn't start with '/' or if auth mode
                requires a secret but none is provided.
        """
        if not self.config.path or not self.config.path.startswith("/"):
            raise ValueError(f"Webhook path must start with '/': {self.config.path}")

        if self.config.auth in ("basic", "bearer", "api_key") and not self.config.secret:
            raise ValueError(f"Auth mode '{self.config.auth}' requires secret")

    async def execute(self, trigger_context: dict[str, Any]) -> dict[str, Any]:
        """Extract webhook payload from trigger context.

        Args:
            trigger_context: Context dictionary from the webhook trigger,
                containing type, payload, headers, method, and query.

        Returns:
            Dictionary with extracted webhook data:
            - payload: Request body data
            - headers: HTTP headers
            - method: HTTP method used
            - path: Configured webhook path
            - query: URL query parameters

        Raises:
            RuntimeError: If trigger_context type is not 'webhook'.
        """
        if trigger_context.get("type") != "webhook":
            raise RuntimeError(
                f"TriggerWebhookNode expects webhook trigger, got: {trigger_context.get('type')}"
            )

        return self._extract_webhook_output(trigger_context)

    def _extract_webhook_output(self, trigger_context: Mapping[str, Any]) -> dict[str, Any]:
        return {
            "payload": trigger_context.get("payload", {}),
            "headers": trigger_context.get("headers", {}),
            "method": trigger_context.get("method", self.config.method),
            "path": self.config.path,
            "query": trigger_context.get("query", {}),
        }

    def execute_sync(self, trigger_context: dict[str, Any]) -> dict[str, Any]:
        """Synchronous visit body for `GraphRunner` (no event loop)."""
        if trigger_context.get("type") != "webhook":
            raise RuntimeError(
                f"TriggerWebhookNode expects webhook trigger, got: {trigger_context.get('type')}"
            )
        return self._extract_webhook_output(trigger_context)
