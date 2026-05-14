# Copyright GraphCaster. All Rights Reserved.

"""Tests for the Composio integrations bridge (F66).

All SDK calls are mocked — composio-core is NOT required to run these tests.
"""

from __future__ import annotations

import asyncio
import os
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_mock_client(
    apps: list[Any] | None = None,
    actions: list[Any] | None = None,
    execute_result: dict | None = None,
) -> MagicMock:
    """Build a mock Composio SDK client."""
    client = MagicMock()

    if apps is None:
        apps = [{"name": "GITHUB"}, {"name": "SLACK"}]
    if actions is None:
        actions = [
            {
                "name": "GITHUB_CREATE_ISSUE",
                "appName": "GITHUB",
                "displayName": "Create Issue",
                "description": "Creates a GitHub issue.",
                "parameters": {"type": "object", "properties": {"title": {"type": "string"}}},
            }
        ]
    if execute_result is None:
        execute_result = {"success": True, "issue_url": "https://github.com/foo/bar/issues/1"}

    client.apps.get.return_value = apps
    client.actions.get.return_value = actions

    entity_mock = MagicMock()
    entity_mock.execute.return_value = execute_result
    client.get_entity.return_value = entity_mock

    return client


def _patch_composio(mock_client: MagicMock):
    """Return a context manager that patches composio.Composio."""
    composio_module = MagicMock()
    composio_module.Composio.return_value = mock_client
    return patch.dict("sys.modules", {"composio": composio_module})


# ---------------------------------------------------------------------------
# ComposioBridge — unit tests
# ---------------------------------------------------------------------------


class TestComposioBridgeListApps:
    def test_returns_app_names(self):
        mock_client = _make_mock_client(apps=[{"name": "GITHUB"}, {"name": "SLACK"}])
        with _patch_composio(mock_client):
            from graph_caster.tools.composio.bridge import ComposioBridge

            bridge = ComposioBridge(api_key="test-key")
            bridge._client = mock_client
            result = asyncio.run(bridge.list_apps())

        assert result == ["GITHUB", "SLACK"]

    def test_empty_apps(self):
        mock_client = _make_mock_client(apps=[])
        with _patch_composio(mock_client):
            from graph_caster.tools.composio.bridge import ComposioBridge

            bridge = ComposioBridge(api_key="test-key")
            bridge._client = mock_client
            result = asyncio.run(bridge.list_apps())

        assert result == []


class TestComposioBridgeListActions:
    def test_returns_all_actions(self):
        mock_client = _make_mock_client()
        with _patch_composio(mock_client):
            from graph_caster.tools.composio.bridge import ComposioBridge

            bridge = ComposioBridge(api_key="test-key")
            bridge._client = mock_client
            result = asyncio.run(bridge.list_actions())

        assert len(result) == 1
        assert result[0].name == "GITHUB_CREATE_ISSUE"
        assert result[0].app == "GITHUB"
        assert result[0].display_name == "Create Issue"

    def test_filters_by_app(self):
        mock_client = _make_mock_client()
        with _patch_composio(mock_client):
            from graph_caster.tools.composio.bridge import ComposioBridge

            bridge = ComposioBridge(api_key="test-key")
            bridge._client = mock_client
            asyncio.run(bridge.list_actions(app="GITHUB"))

        mock_client.actions.get.assert_called_once_with(apps=["GITHUB"])


class TestComposioBridgeInvoke:
    def test_invokes_action_with_correct_args(self):
        execute_result = {"ok": True, "message_ts": "12345"}
        mock_client = _make_mock_client(execute_result=execute_result)
        with _patch_composio(mock_client):
            from graph_caster.tools.composio.bridge import ComposioBridge

            bridge = ComposioBridge(api_key="test-key")
            bridge._client = mock_client
            result = asyncio.run(
                bridge.invoke(
                    "SLACK_SEND_MESSAGE",
                    {"channel": "#general", "text": "Hello"},
                    entity_id="user123",
                )
            )

        assert result == execute_result
        mock_client.get_entity.assert_called_once_with(id="user123")
        entity = mock_client.get_entity.return_value
        entity.execute.assert_called_once_with(
            action="SLACK_SEND_MESSAGE", params={"channel": "#general", "text": "Hello"}
        )

    def test_default_entity_id(self):
        mock_client = _make_mock_client()
        with _patch_composio(mock_client):
            from graph_caster.tools.composio.bridge import ComposioBridge

            bridge = ComposioBridge(api_key="test-key")
            bridge._client = mock_client
            asyncio.run(bridge.invoke("GITHUB_CREATE_ISSUE", {}))

        mock_client.get_entity.assert_called_once_with(id="default")


class TestComposioBridgeGetActionSchema:
    def test_returns_parameters_schema(self):
        schema = {"type": "object", "properties": {"title": {"type": "string"}}}
        actions = [
            {
                "name": "GITHUB_CREATE_ISSUE",
                "appName": "GITHUB",
                "displayName": "Create Issue",
                "description": "Creates a GitHub issue.",
                "parameters": schema,
            }
        ]
        mock_client = _make_mock_client(actions=actions)
        with _patch_composio(mock_client):
            from graph_caster.tools.composio.bridge import ComposioBridge

            bridge = ComposioBridge(api_key="test-key")
            bridge._client = mock_client
            result = asyncio.run(bridge.get_action_schema("GITHUB_CREATE_ISSUE"))

        assert result == schema

    def test_returns_empty_dict_for_unknown_action(self):
        mock_client = _make_mock_client(actions=[])
        with _patch_composio(mock_client):
            from graph_caster.tools.composio.bridge import ComposioBridge

            bridge = ComposioBridge(api_key="test-key")
            bridge._client = mock_client
            result = asyncio.run(bridge.get_action_schema("NO_SUCH_ACTION"))

        assert result == {}


# ---------------------------------------------------------------------------
# API key resolution order
# ---------------------------------------------------------------------------


class TestApiKeyResolution:
    def test_explicit_arg_wins(self, tmp_path: Path):
        secrets_dir = tmp_path / ".graphcaster"
        secrets_dir.mkdir()
        (secrets_dir / "workspace.secrets.env").write_text(
            "COMPOSIO_API_KEY=ws-key\n", encoding="utf-8"
        )
        with patch.dict(os.environ, {"COMPOSIO_API_KEY": "env-key"}, clear=False):
            from graph_caster.tools.composio.auth import resolve_api_key

            result = resolve_api_key(api_key="explicit-key", workspace_root=tmp_path)
        assert result == "explicit-key"

    def test_env_var_over_workspace_secrets(self, tmp_path: Path):
        secrets_dir = tmp_path / ".graphcaster"
        secrets_dir.mkdir()
        (secrets_dir / "workspace.secrets.env").write_text(
            "COMPOSIO_API_KEY=ws-key\n", encoding="utf-8"
        )
        with patch.dict(os.environ, {"COMPOSIO_API_KEY": "env-key"}, clear=False):
            from importlib import reload

            import graph_caster.tools.composio.auth as auth_mod

            reload(auth_mod)
            result = auth_mod.resolve_api_key(workspace_root=tmp_path)
        assert result == "env-key"

    def test_workspace_secrets_fallback(self, tmp_path: Path, monkeypatch):
        monkeypatch.delenv("COMPOSIO_API_KEY", raising=False)
        secrets_dir = tmp_path / ".graphcaster"
        secrets_dir.mkdir()
        (secrets_dir / "workspace.secrets.env").write_text(
            "COMPOSIO_API_KEY=ws-key\n", encoding="utf-8"
        )
        from graph_caster.tools.composio.auth import resolve_api_key

        result = resolve_api_key(workspace_root=tmp_path)
        assert result == "ws-key"

    def test_no_key_returns_none(self, monkeypatch):
        monkeypatch.delenv("COMPOSIO_API_KEY", raising=False)
        from graph_caster.tools.composio.auth import resolve_api_key

        result = resolve_api_key()
        assert result is None


# ---------------------------------------------------------------------------
# Missing SDK — ImportError with helpful message
# ---------------------------------------------------------------------------


class TestMissingSdk:
    def test_import_error_has_install_hint(self, monkeypatch):
        monkeypatch.setitem(__import__("sys").modules, "composio", None)
        from graph_caster.tools.composio.bridge import ComposioBridge, _INSTALL_HINT

        bridge = ComposioBridge(api_key="key")
        with pytest.raises(ImportError) as exc_info:
            asyncio.run(bridge.list_apps())
        assert "composio-core" in str(exc_info.value)
        assert "pip install" in str(exc_info.value)

    def test_install_hint_constant_contains_extra_name(self):
        from graph_caster.tools.composio.bridge import _INSTALL_HINT

        assert ".[composio]" in _INSTALL_HINT


# ---------------------------------------------------------------------------
# ComposioActionNode — F95 declarative node
# ---------------------------------------------------------------------------


class TestComposioActionNode:
    def _make_ctx(self, bridge) -> dict:
        ctx: dict = {"_composio_bridge": bridge}
        return ctx

    def test_node_registered_in_f95_registry(self):
        import importlib

        import graph_caster.nodes.composio_action  # noqa: F401 — ensure side effect

        importlib.import_module("graph_caster.nodes.composio_action")
        from graph_caster.node_api.registry import get_registered

        cls = get_registered("composio_action", 1.0)
        assert cls is not None
        assert cls.type == "composio_action"

    def test_node_type_and_version(self):
        from graph_caster.nodes.composio_action import ComposioActionNode

        assert ComposioActionNode.type == "composio_action"
        assert ComposioActionNode.version == 1.0
        assert ComposioActionNode.display_name == "Composio Action"

    def test_node_has_correct_inputs(self):
        from graph_caster.nodes.composio_action import ComposioActionNode

        input_names = [i.name for i in ComposioActionNode.inputs]
        assert "action" in input_names
        assert "params" in input_names
        assert "entityId" in input_names
        assert "timeoutSec" in input_names

    def test_node_has_result_output(self):
        from graph_caster.nodes.composio_action import ComposioActionNode

        output_names = [o.name for o in ComposioActionNode.outputs]
        assert "result" in output_names

    def test_run_invokes_bridge(self):
        from graph_caster.nodes.composio_action import ComposioActionNode

        invoke_result = {"ok": True, "ts": "abc"}

        bridge_mock = MagicMock()
        bridge_mock.invoke = AsyncMock(return_value=invoke_result)

        ctx = self._make_ctx(bridge_mock)
        node = ComposioActionNode()
        result = asyncio.run(
            node.run(
                ctx,
                action="SLACK_SEND_MESSAGE",
                params={"channel": "#dev", "text": "Hi"},
                entityId="default",
                timeoutSec=30.0,
            )
        )

        assert result == {"result": invoke_result}
        bridge_mock.invoke.assert_awaited_once_with(
            "SLACK_SEND_MESSAGE",
            {"channel": "#dev", "text": "Hi"},
            entity_id="default",
        )

    def test_run_uses_custom_entity_id(self):
        from graph_caster.nodes.composio_action import ComposioActionNode

        bridge_mock = MagicMock()
        bridge_mock.invoke = AsyncMock(return_value={"done": True})

        ctx = self._make_ctx(bridge_mock)
        node = ComposioActionNode()
        asyncio.run(
            node.run(
                ctx,
                action="GITHUB_CREATE_ISSUE",
                params={"title": "Bug"},
                entityId="user-456",
                timeoutSec=15.0,
            )
        )

        _, kwargs = bridge_mock.invoke.call_args
        assert kwargs["entity_id"] == "user-456"

    def test_run_timeout_raises(self):
        from graph_caster.nodes.composio_action import ComposioActionNode

        async def _slow(*args, **kwargs):
            await asyncio.sleep(10)
            return {}

        bridge_mock = MagicMock()
        bridge_mock.invoke = _slow

        ctx = self._make_ctx(bridge_mock)
        node = ComposioActionNode()
        with pytest.raises(asyncio.TimeoutError):
            asyncio.run(
                node.run(
                    ctx,
                    action="SLACK_SEND_MESSAGE",
                    params={},
                    entityId="default",
                    timeoutSec=0.01,
                )
            )

    def test_schema_generation_via_f95(self):
        from graph_caster.nodes.composio_action import ComposioActionNode

        schema = ComposioActionNode.schema()
        assert "properties" in schema
        assert "action" in schema["properties"]
        assert "params" in schema["properties"]
        assert schema["required"] == ["action", "params"]


# ---------------------------------------------------------------------------
# Action registry parser
# ---------------------------------------------------------------------------


class TestActionRegistry:
    def test_parse_dict_action(self):
        from graph_caster.tools.composio.action_registry import _parse_action

        raw = {
            "name": "GITHUB_CREATE_ISSUE",
            "appName": "GITHUB",
            "displayName": "Create Issue",
            "description": "Creates a GitHub issue.",
            "parameters": {"type": "object"},
        }
        meta = _parse_action(raw)
        assert meta.name == "GITHUB_CREATE_ISSUE"
        assert meta.app == "GITHUB"
        assert meta.display_name == "Create Issue"
        assert meta.description == "Creates a GitHub issue."
        assert meta.parameters == {"type": "object"}

    def test_parse_object_action(self):
        from graph_caster.tools.composio.action_registry import _parse_action

        raw = MagicMock()
        raw.name = "SLACK_SEND_MESSAGE"
        raw.app_name = "SLACK"
        raw.display_name = "Send Message"
        raw.description = "Sends a Slack message."
        raw.parameters = {"type": "object", "properties": {}}

        meta = _parse_action(raw)
        assert meta.name == "SLACK_SEND_MESSAGE"
        assert meta.app == "SLACK"

    def test_parse_actions_list(self):
        from graph_caster.tools.composio.action_registry import parse_actions

        raws = [
            {"name": "A1", "appName": "APP", "displayName": "Action 1", "description": "", "parameters": {}},
            {"name": "A2", "appName": "APP", "displayName": "Action 2", "description": "", "parameters": {}},
        ]
        result = parse_actions(raws)
        assert len(result) == 2
        assert result[0].name == "A1"
        assert result[1].name == "A2"
