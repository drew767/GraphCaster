# Copyright GraphCaster. All Rights Reserved.

"""SSO provider config store (UX58 / F85 extension).

Admin-managed per-tenant SSO provider configuration. Secrets are stored
encrypted; in the InMemory implementation the field is kept as-is for
test convenience. A real implementation would wrap via F8 SecretsProvider.

Storage layout (file-based): .graphcaster/sso/<tenant_id>/<provider>.json
"""

from __future__ import annotations

import json
import os
from abc import ABC, abstractmethod
from copy import deepcopy
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


_VALID_PROVIDERS = frozenset({"google", "github", "microsoft", "oidc", "saml"})


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class SsoProviderConfig:
    provider: str
    enabled: bool
    client_id: str
    client_secret_encrypted: str
    redirect_uri: str
    issuer_url: str | None = None
    metadata_url: str | None = None
    cert: str | None = None
    domain_restriction: str | None = None
    created_at: str = field(default_factory=_utcnow)
    updated_at: str = field(default_factory=_utcnow)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d.pop("client_secret_encrypted", None)
        return d

    def to_dict_full(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "SsoProviderConfig":
        provider = str(d.get("provider", "")).lower()
        if provider not in _VALID_PROVIDERS:
            raise ValueError(f"Invalid SSO provider: {provider!r}. Valid: {sorted(_VALID_PROVIDERS)}")
        return cls(
            provider=provider,
            enabled=bool(d.get("enabled", True)),
            client_id=str(d.get("client_id") or ""),
            client_secret_encrypted=str(d.get("client_secret_encrypted") or ""),
            redirect_uri=str(d.get("redirect_uri") or ""),
            issuer_url=d.get("issuer_url"),
            metadata_url=d.get("metadata_url"),
            cert=d.get("cert"),
            domain_restriction=d.get("domain_restriction"),
            created_at=str(d.get("created_at") or _utcnow()),
            updated_at=str(d.get("updated_at") or _utcnow()),
        )


class SsoConfigStore(ABC):
    """Abstract async store for per-tenant SSO provider configs."""

    @abstractmethod
    async def list(self, tenant_id: str) -> list[SsoProviderConfig]: ...

    @abstractmethod
    async def get(self, provider: str, tenant_id: str) -> SsoProviderConfig | None: ...

    @abstractmethod
    async def upsert(self, provider: str, tenant_id: str, config: SsoProviderConfig) -> SsoProviderConfig: ...

    @abstractmethod
    async def delete(self, provider: str, tenant_id: str) -> None: ...

    @abstractmethod
    async def test(self, provider: str, tenant_id: str) -> dict[str, Any]:
        """Verify SSO config by attempting a lightweight connectivity check."""
        ...


class InMemorySsoConfigStore(SsoConfigStore):
    """Dict-backed SSO config store for tests."""

    def __init__(self) -> None:
        self._configs: dict[tuple[str, str], SsoProviderConfig] = {}

    async def list(self, tenant_id: str) -> list[SsoProviderConfig]:
        return [
            deepcopy(c)
            for (p, tid), c in self._configs.items()
            if tid == tenant_id
        ]

    async def get(self, provider: str, tenant_id: str) -> SsoProviderConfig | None:
        c = self._configs.get((provider.lower(), tenant_id))
        return deepcopy(c) if c is not None else None

    async def upsert(self, provider: str, tenant_id: str, config: SsoProviderConfig) -> SsoProviderConfig:
        key = (provider.lower(), tenant_id)
        now = _utcnow()
        existing = self._configs.get(key)
        updated = deepcopy(config)
        updated.provider = provider.lower()
        updated.updated_at = now
        if existing is None:
            updated.created_at = now
        else:
            updated.created_at = existing.created_at
        self._configs[key] = updated
        return deepcopy(updated)

    async def delete(self, provider: str, tenant_id: str) -> None:
        self._configs.pop((provider.lower(), tenant_id), None)

    async def test(self, provider: str, tenant_id: str) -> dict[str, Any]:
        cfg = await self.get(provider, tenant_id)
        if cfg is None:
            return {"ok": False, "message": f"Provider {provider!r} not configured for tenant {tenant_id!r}"}
        if not cfg.enabled:
            return {"ok": False, "message": f"Provider {provider!r} is disabled"}
        if not cfg.client_id:
            return {"ok": False, "message": "client_id is missing"}
        return {"ok": True, "message": "Configuration looks valid"}


class FileSsoConfigStore(SsoConfigStore):
    """JSON-on-disk SSO config store.

    Layout: <workspace_root>/.graphcaster/sso/<tenant_id>/<provider>.json
    """

    def __init__(self, workspace_root: Path) -> None:
        self._root = workspace_root

    def _dir(self, tenant_id: str) -> Path:
        return self._root / ".graphcaster" / "sso" / tenant_id

    def _path(self, provider: str, tenant_id: str) -> Path:
        return self._dir(tenant_id) / f"{provider.lower()}.json"

    async def list(self, tenant_id: str) -> list[SsoProviderConfig]:
        d = self._dir(tenant_id)
        if not d.exists():
            return []
        configs = []
        for fp in sorted(d.glob("*.json")):
            try:
                raw = json.loads(fp.read_text(encoding="utf-8"))
                configs.append(SsoProviderConfig.from_dict(raw))
            except Exception:
                pass
        return configs

    async def get(self, provider: str, tenant_id: str) -> SsoProviderConfig | None:
        fp = self._path(provider, tenant_id)
        if not fp.exists():
            return None
        try:
            raw = json.loads(fp.read_text(encoding="utf-8"))
            return SsoProviderConfig.from_dict(raw)
        except Exception:
            return None

    async def upsert(self, provider: str, tenant_id: str, config: SsoProviderConfig) -> SsoProviderConfig:
        existing = await self.get(provider, tenant_id)
        now = _utcnow()
        updated = deepcopy(config)
        updated.provider = provider.lower()
        updated.updated_at = now
        if existing is None:
            updated.created_at = now
        else:
            updated.created_at = existing.created_at
        d = self._dir(tenant_id)
        d.mkdir(parents=True, exist_ok=True)
        fp = self._path(provider, tenant_id)
        tmp = fp.with_suffix(".tmp")
        tmp.write_text(json.dumps(updated.to_dict_full(), ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, fp)
        return deepcopy(updated)

    async def delete(self, provider: str, tenant_id: str) -> None:
        fp = self._path(provider, tenant_id)
        if fp.exists():
            fp.unlink()

    async def test(self, provider: str, tenant_id: str) -> dict[str, Any]:
        cfg = await self.get(provider, tenant_id)
        if cfg is None:
            return {"ok": False, "message": f"Provider {provider!r} not configured for tenant {tenant_id!r}"}
        if not cfg.enabled:
            return {"ok": False, "message": f"Provider {provider!r} is disabled"}
        return await _connectivity_check(cfg)


async def _connectivity_check(cfg: SsoProviderConfig) -> dict[str, Any]:
    """Lightweight connectivity check — fetches discovery/userinfo endpoint."""
    try:
        import urllib.request

        if cfg.provider == "oidc" and cfg.issuer_url:
            discovery_url = cfg.issuer_url.rstrip("/") + "/.well-known/openid-configuration"
            with urllib.request.urlopen(discovery_url, timeout=5) as resp:
                if resp.status == 200:
                    return {"ok": True, "message": "OIDC discovery reachable"}
            return {"ok": False, "message": f"OIDC discovery returned {resp.status}"}
        if cfg.provider == "github":
            with urllib.request.urlopen("https://api.github.com", timeout=5) as resp:
                if resp.status == 200:
                    return {"ok": True, "message": "GitHub API reachable"}
        if cfg.provider in ("google", "microsoft"):
            return {"ok": True, "message": "Configuration looks valid"}
        if cfg.provider == "saml" and cfg.metadata_url:
            with urllib.request.urlopen(cfg.metadata_url, timeout=5) as resp:
                if resp.status == 200:
                    return {"ok": True, "message": "SAML metadata reachable"}
            return {"ok": False, "message": f"SAML metadata returned {resp.status}"}
        return {"ok": True, "message": "Configuration looks valid"}
    except Exception as exc:
        return {"ok": False, "message": str(exc)}
