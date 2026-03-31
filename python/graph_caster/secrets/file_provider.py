# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from graph_caster.secrets_loader import load_workspace_secrets, secrets_file_fingerprint


@dataclass(frozen=True)
class FileSecretsProvider:
    """``workspace.secrets.env`` under ``<workspaceRoot>/.graphcaster/``."""

    workspace_root: Path | None

    def as_mapping(self) -> dict[str, str]:
        return load_workspace_secrets(self.workspace_root)

    def fingerprint(self) -> str:
        return secrets_file_fingerprint(self.workspace_root)
