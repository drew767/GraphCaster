# Copyright GraphCaster. All Rights Reserved.

"""Credential resolution for the Composio bridge.

Priority order:
  1. Explicit api_key argument.
  2. COMPOSIO_API_KEY environment variable.
  3. Workspace secrets (F8) — reads .graphcaster/workspace.secrets.env.
"""

from __future__ import annotations

import os
from pathlib import Path

_ENV_KEY = "COMPOSIO_API_KEY"


def resolve_api_key(
    api_key: str | None = None,
    workspace_root: Path | None = None,
) -> str | None:
    """Return the Composio API key from the first available source.

    Returns None when no key is found anywhere; callers decide whether to raise.
    """
    if api_key:
        return api_key

    env_val = os.environ.get(_ENV_KEY, "").strip()
    if env_val:
        return env_val

    if workspace_root is not None:
        from graph_caster.secrets_loader import load_workspace_secrets

        secrets = load_workspace_secrets(workspace_root)
        ws_val = secrets.get(_ENV_KEY, "").strip()
        if ws_val:
            return ws_val

    return None
