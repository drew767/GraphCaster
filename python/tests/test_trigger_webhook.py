# Copyright Aura. All Rights Reserved.

"""Tests for webhook trigger node and trigger context."""

from __future__ import annotations

import time

import pytest

from graph_caster.triggers.base import TriggerContext, TriggerType
from graph_caster.nodes.trigger_webhook import TriggerWebhookNode, WebhookNodeConfig


class TestTriggerType:
    """Tests for TriggerType enum."""

    def test_trigger_type_values(self) -> None:
        assert TriggerType.WEBHOOK.value == "webhook"
        assert TriggerType.SCHEDULE.value == "schedule"
        assert TriggerType.MANUAL.value == "manual"
        assert TriggerType.API.value == "api"


class TestTriggerContext:
    """Tests for TriggerContext dataclass."""

    def test_trigger_context_default_values(self) -> None:
        ctx = TriggerContext(
            trigger_type=TriggerType.WEBHOOK,
            trigger_id="test-trigger-123",
        )
        assert ctx.trigger_type == TriggerType.WEBHOOK
        assert ctx.trigger_id == "test-trigger-123"
        assert ctx.payload == {}
        assert ctx.headers == {}
        assert isinstance(ctx.timestamp, float)

    def test_trigger_context_with_payload(self) -> None:
        payload = {"user_id": 42, "action": "create"}
        headers = {"Content-Type": "application/json", "X-Custom": "value"}
        ts = 1711900000.0

        ctx = TriggerContext(
            trigger_type=TriggerType.WEBHOOK,
            trigger_id="wh-abc",
            payload=payload,
            headers=headers,
            timestamp=ts,
        )

        assert ctx.payload == payload
        assert ctx.headers == headers
        assert ctx.timestamp == ts

    def test_to_context_vars_serializes_correctly(self) -> None:
        ctx = TriggerContext(
            trigger_type=TriggerType.WEBHOOK,
            trigger_id="wh-xyz",
            payload={"key": "value"},
            headers={"Authorization": "Bearer token"},
            timestamp=1711900000.0,
        )

        result = ctx.to_context_vars()

        assert "trigger" in result
        trigger = result["trigger"]
        assert trigger["type"] == "webhook"
        assert trigger["id"] == "wh-xyz"
        assert trigger["payload"] == {"key": "value"}
        assert trigger["headers"] == {"Authorization": "Bearer token"}
        assert trigger["timestamp"] == 1711900000.0

    def test_to_context_vars_with_different_trigger_types(self) -> None:
        for ttype in TriggerType:
            ctx = TriggerContext(trigger_type=ttype, trigger_id="test")
            result = ctx.to_context_vars()
            assert result["trigger"]["type"] == ttype.value


class TestWebhookNodeConfig:
    """Tests for WebhookNodeConfig dataclass."""

    def test_config_default_values(self) -> None:
        config = WebhookNodeConfig(path="/api/webhook")
        assert config.path == "/api/webhook"
        assert config.method == "POST"
        assert config.auth == "none"
        assert config.secret is None
        assert config.response_mode == "immediate"

    def test_config_with_all_values(self) -> None:
        config = WebhookNodeConfig(
            path="/hooks/event",
            method="PUT",
            auth="bearer",
            secret="my-secret-token",
            response_mode="wait",
        )
        assert config.path == "/hooks/event"
        assert config.method == "PUT"
        assert config.auth == "bearer"
        assert config.secret == "my-secret-token"
        assert config.response_mode == "wait"


class TestTriggerWebhookNode:
    """Tests for TriggerWebhookNode."""

    def test_node_type_is_trigger_webhook(self) -> None:
        assert TriggerWebhookNode.node_type == "trigger_webhook"

    def test_node_initialization(self) -> None:
        node = TriggerWebhookNode(
            node_id="node-1",
            config={"path": "/webhook/test"},
        )
        assert node.id == "node-1"
        assert node.config.path == "/webhook/test"
        assert node.config.method == "POST"

    def test_validate_path_must_start_with_slash(self) -> None:
        node = TriggerWebhookNode(
            node_id="node-2",
            config={"path": "webhook/no-slash"},
        )
        with pytest.raises(ValueError, match="path must start with '/'"):
            node.validate()

    def test_validate_empty_path_fails(self) -> None:
        node = TriggerWebhookNode(
            node_id="node-3",
            config={"path": ""},
        )
        with pytest.raises(ValueError, match="path must start with '/'"):
            node.validate()

    def test_validate_auth_basic_requires_secret(self) -> None:
        node = TriggerWebhookNode(
            node_id="node-4",
            config={"path": "/hook", "auth": "basic"},
        )
        with pytest.raises(ValueError, match="Auth mode 'basic' requires secret"):
            node.validate()

    def test_validate_auth_bearer_requires_secret(self) -> None:
        node = TriggerWebhookNode(
            node_id="node-5",
            config={"path": "/hook", "auth": "bearer"},
        )
        with pytest.raises(ValueError, match="Auth mode 'bearer' requires secret"):
            node.validate()

    def test_validate_auth_api_key_requires_secret(self) -> None:
        node = TriggerWebhookNode(
            node_id="node-6",
            config={"path": "/hook", "auth": "api_key"},
        )
        with pytest.raises(ValueError, match="Auth mode 'api_key' requires secret"):
            node.validate()

    def test_validate_auth_none_does_not_require_secret(self) -> None:
        node = TriggerWebhookNode(
            node_id="node-7",
            config={"path": "/hook", "auth": "none"},
        )
        node.validate()

    def test_validate_auth_with_secret_passes(self) -> None:
        node = TriggerWebhookNode(
            node_id="node-8",
            config={"path": "/hook", "auth": "bearer", "secret": "my-token"},
        )
        node.validate()

    @pytest.mark.anyio
    async def test_execute_extracts_payload_correctly(self) -> None:
        node = TriggerWebhookNode(
            node_id="node-9",
            config={"path": "/api/events"},
        )

        trigger_context = {
            "type": "webhook",
            "payload": {"event": "user.created", "data": {"id": 123}},
            "headers": {"Content-Type": "application/json"},
            "method": "POST",
            "query": {"version": "2"},
        }

        result = await node.execute(trigger_context)

        assert result["payload"] == {"event": "user.created", "data": {"id": 123}}
        assert result["headers"] == {"Content-Type": "application/json"}
        assert result["method"] == "POST"
        assert result["path"] == "/api/events"
        assert result["query"] == {"version": "2"}

    @pytest.mark.anyio
    async def test_execute_uses_config_method_as_default(self) -> None:
        node = TriggerWebhookNode(
            node_id="node-10",
            config={"path": "/hook", "method": "PUT"},
        )

        trigger_context = {
            "type": "webhook",
            "payload": {},
        }

        result = await node.execute(trigger_context)
        assert result["method"] == "PUT"

    @pytest.mark.anyio
    async def test_execute_raises_on_wrong_trigger_type(self) -> None:
        node = TriggerWebhookNode(
            node_id="node-11",
            config={"path": "/hook"},
        )

        trigger_context = {
            "type": "schedule",
            "payload": {},
        }

        with pytest.raises(RuntimeError, match="expects webhook trigger, got: schedule"):
            await node.execute(trigger_context)

    @pytest.mark.anyio
    async def test_execute_handles_missing_optional_fields(self) -> None:
        node = TriggerWebhookNode(
            node_id="node-12",
            config={"path": "/minimal"},
        )

        trigger_context = {"type": "webhook"}

        result = await node.execute(trigger_context)

        assert result["payload"] == {}
        assert result["headers"] == {}
        assert result["query"] == {}
        assert result["path"] == "/minimal"
