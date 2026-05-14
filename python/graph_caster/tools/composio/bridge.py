# Copyright GraphCaster. All Rights Reserved.

"""ComposioBridge — async facade over the Composio Python SDK.

Requires the optional extra:
    pip install -e '.[composio]'

The SDK (composio-core) is imported lazily inside each method so the module can
be imported unconditionally; the ImportError with an install hint is raised only
when a bridge method is actually called without the SDK present.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from graph_caster.tools.composio.action_registry import ComposioActionMeta, parse_actions
from graph_caster.tools.composio.auth import resolve_api_key

_INSTALL_HINT = (
    "composio-core is not installed. "
    "Install the optional extra: pip install -e '.[composio]'"
)


def _require_composio() -> Any:
    """Return the composio module or raise ImportError with install hint."""
    try:
        import composio  # noqa: PLC0415

        return composio
    except ImportError as exc:
        raise ImportError(_INSTALL_HINT) from exc


class ComposioBridge:
    """Async bridge to the Composio SDK.

    Composio's synchronous SDK calls are run in a thread-pool executor to keep
    the calling coroutine non-blocking.  All public methods are ``async``.

    Parameters
    ----------
    api_key:
        Explicit API key.  When omitted the bridge tries (in order):
        ``COMPOSIO_API_KEY`` environment variable, then the workspace secrets
        file ``<workspace_root>/.graphcaster/workspace.secrets.env`` (F8).
    workspace_root:
        Optional workspace root used for secret resolution.
    """

    def __init__(
        self,
        api_key: str | None = None,
        workspace_root: Path | None = None,
    ) -> None:
        self._raw_api_key = api_key
        self._workspace_root = workspace_root
        self._client: Any = None

    def _resolved_key(self) -> str | None:
        return resolve_api_key(self._raw_api_key, self._workspace_root)

    def _get_client(self) -> Any:
        if self._client is not None:
            return self._client
        composio = _require_composio()
        key = self._resolved_key()
        try:
            if key:
                self._client = composio.Composio(api_key=key)
            else:
                self._client = composio.Composio()
        except AttributeError:
            self._client = composio.client.Composio(api_key=key) if key else composio.client.Composio()
        return self._client

    async def _run_sync(self, fn, *args, **kwargs) -> Any:  # noqa: ANN001
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, lambda: fn(*args, **kwargs))

    async def list_apps(self) -> list[str]:
        """Return a list of enabled app names for the connected account."""
        client = self._get_client()

        def _fetch():
            try:
                apps = client.apps.get()
            except AttributeError:
                apps = client.get_apps()
            if isinstance(apps, list):
                result = []
                for a in apps:
                    if isinstance(a, dict):
                        result.append(a.get("name") or a.get("key") or str(a))
                    else:
                        result.append(
                            getattr(a, "name", None)
                            or getattr(a, "key", None)
                            or str(a)
                        )
                return result
            return []

        return await self._run_sync(_fetch)

    async def list_actions(self, app: str | None = None) -> list[ComposioActionMeta]:
        """List available actions, optionally filtered by app name."""
        client = self._get_client()

        def _fetch():
            try:
                if app:
                    raw = client.actions.get(apps=[app])
                else:
                    raw = client.actions.get()
            except AttributeError:
                if app:
                    raw = client.get_actions(apps=[app])
                else:
                    raw = client.get_actions()
            if not isinstance(raw, list):
                raw = list(raw) if raw is not None else []
            return parse_actions(raw)

        return await self._run_sync(_fetch)

    async def invoke(
        self,
        action: str,
        params: dict,
        *,
        entity_id: str = "default",
    ) -> dict:
        """Execute a Composio action and return the response dict.

        Parameters
        ----------
        action:
            Action name, e.g. ``"GITHUB_CREATE_ISSUE"``.
        params:
            Action parameters dict.
        entity_id:
            Composio entity identifier for multi-user scenarios.
        """
        client = self._get_client()

        def _exec():
            try:
                entity = client.get_entity(id=entity_id)
                result = entity.execute(action=action, params=params)
            except AttributeError:
                result = client.execute_action(
                    action=action, params=params, entity_id=entity_id
                )
            if isinstance(result, dict):
                return result
            if hasattr(result, "__dict__"):
                return dict(result.__dict__)
            return {"response": str(result)}

        return await self._run_sync(_exec)

    async def get_action_schema(self, action: str) -> dict:
        """Return the JSON schema for an action's parameters."""
        client = self._get_client()

        def _fetch():
            try:
                raw_list = client.actions.get(actions=[action])
            except AttributeError:
                raw_list = client.get_actions(actions=[action])
            if not raw_list:
                return {}
            raw = raw_list[0]
            if isinstance(raw, dict):
                return raw.get("parameters", {})
            return getattr(raw, "parameters", {}) or {}

        return await self._run_sync(_fetch)
