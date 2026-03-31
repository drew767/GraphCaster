# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import os
from pathlib import Path

from graph_caster.secrets.aws_provider import AwsJsonSecretsProvider
from graph_caster.secrets.file_provider import FileSecretsProvider
from graph_caster.secrets.providers import SecretsProvider
from graph_caster.secrets.vault_provider import VaultKv2SecretsProvider


def make_secrets_provider(workspace_root: Path | None) -> SecretsProvider:
    """Build provider from ``GC_SECRETS_PROVIDER``: **file** (default), **vault**, **aws**."""
    kind = os.environ.get("GC_SECRETS_PROVIDER", "").strip().lower() or "file"
    if kind in ("file", ""):
        return FileSecretsProvider(workspace_root)
    if kind == "vault":
        return VaultKv2SecretsProvider.from_env()
    if kind == "aws":
        return AwsJsonSecretsProvider.from_env()
    raise ValueError(
        f"Unknown GC_SECRETS_PROVIDER={kind!r}; expected file, vault, or aws"
    )


def load_workspace_secrets_via_provider(workspace_root: Path | None) -> dict[str, str]:
    return make_secrets_provider(workspace_root).as_mapping()


def secrets_provider_fingerprint(workspace_root: Path | None) -> str:
    return make_secrets_provider(workspace_root).fingerprint()
