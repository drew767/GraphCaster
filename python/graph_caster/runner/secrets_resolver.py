# Copyright GraphCaster. All Rights Reserved.

"""Workspace-secret loading + fingerprinting for :class:`GraphRunner`.

Wraps the lazy :class:`SecretsProvider` so callers (step cache key planning,
subprocess env injection, etc.) get a single cached mapping per runner.
"""

from __future__ import annotations

from typing import Any

from graph_caster.process_exec import task_declares_env_keys
from graph_caster.secrets.providers import SecretsProvider


class WorkspaceSecretsResolver:
    """Lazy accessor for workspace secrets and their integrity fingerprint.

    The underlying :class:`SecretsProvider` is constructed lazily from the
    resolved workspace root the first time secrets (or a fingerprint) are
    requested. Subsequent accesses are cached for the lifetime of the runner.
    """

    def __init__(self, workspace_root_provider: Any) -> None:
        """Initialise the resolver.

        ``workspace_root_provider`` is a callable that returns the resolved
        workspace root path; this matches :meth:`RunHostContext.resolved_workspace_root`.
        """
        self._workspace_root_provider = workspace_root_provider
        self._provider_inst: SecretsProvider | None = None
        self._mapping_loaded = False
        self._mapping: dict[str, str] = {}
        self._fp_loaded = False
        self._fp: str = ""

    def ensure_provider(self) -> SecretsProvider:
        if self._provider_inst is None:
            from graph_caster.secrets.factory import make_secrets_provider

            self._provider_inst = make_secrets_provider(self._workspace_root_provider())
        return self._provider_inst

    def get_mapping(self) -> dict[str, str]:
        if not self._mapping_loaded:
            self._mapping_loaded = True
            self._mapping = self.ensure_provider().as_mapping()
        return self._mapping

    def get_fingerprint(self) -> str:
        if not self._fp_loaded:
            self._fp_loaded = True
            self._fp = self.ensure_provider().fingerprint()
        return self._fp

    def step_cache_fingerprint_for_node(self, node_data: dict[str, Any]) -> str | None:
        """Return the workspace-secrets fingerprint iff the node consumes env keys.

        Step-cache keys must include the secrets fingerprint only when the node
        actually depends on workspace secrets — otherwise the key would churn on
        every secrets-file edit even for nodes that don't read them.
        """
        if not task_declares_env_keys(node_data):
            return None
        return self.get_fingerprint()
