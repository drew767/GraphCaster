# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import os
from dataclasses import dataclass, field


@dataclass
class VaultKv2SecretsProvider:
    """HashiCorp Vault KV v2: one secret path whose **data** payload is a flat string map."""

    mount_point: str
    path: str
    _mapping: dict[str, str] = field(default_factory=dict)
    _version: str = ""

    @classmethod
    def from_env(cls) -> VaultKv2SecretsProvider:
        try:
            import hvac  # type: ignore[import-untyped]
        except ImportError as e:
            raise ImportError(
                "GC_SECRETS_PROVIDER=vault requires hvac; install graph-caster[vault]"
            ) from e

        addr = os.environ.get("VAULT_ADDR", "").strip()
        token = os.environ.get("VAULT_TOKEN", "").strip()
        if not addr or not token:
            raise ValueError(
                "GC_SECRETS_PROVIDER=vault requires VAULT_ADDR and VAULT_TOKEN"
            )
        mount = os.environ.get("GC_VAULT_KV_MOUNT", "secret").strip() or "secret"
        path = os.environ.get("GC_VAULT_KV_PATH", "graphcaster").strip().strip("/") or "graphcaster"

        client = hvac.Client(url=addr, token=token)
        if not client.is_authenticated():
            raise ValueError("Vault client failed authentication (check VAULT_TOKEN)")

        r = client.secrets.kv.v2.read_secret_version(path=path, mount_point=mount)
        meta = r.get("data", {}).get("metadata", {})
        ver = str(meta.get("version", ""))
        raw = r.get("data", {}).get("data", {})
        if not isinstance(raw, dict):
            raise ValueError("Vault KV data must be a JSON object (string keys)")
        mapping = {
            str(k): "" if v is None else str(v)
            for k, v in raw.items()
        }
        return cls(
            mount_point=mount,
            path=path,
            _mapping=mapping,
            _version=ver,
        )

    def as_mapping(self) -> dict[str, str]:
        return dict(self._mapping)

    def fingerprint(self) -> str:
        return f"vault:{self.mount_point}:{self.path}:v{self._version}"
