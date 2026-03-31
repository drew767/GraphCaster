# Copyright GraphCaster. All Rights Reserved.

"""Pluggable workspace secrets (file, optional Vault KV v2, optional AWS Secrets Manager JSON)."""

from __future__ import annotations

from graph_caster.secrets.factory import (
    load_workspace_secrets_via_provider,
    make_secrets_provider,
    secrets_provider_fingerprint,
)
from graph_caster.secrets.providers import SecretsProvider

__all__ = [
    "SecretsProvider",
    "make_secrets_provider",
    "load_workspace_secrets_via_provider",
    "secrets_provider_fingerprint",
]
