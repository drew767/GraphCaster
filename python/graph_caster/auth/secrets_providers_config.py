# Copyright GraphCaster. All Rights Reserved.

"""Secrets-provider connection config store (UX55 / F8 extension).

Stores connection metadata for each SecretsProvider backend (file, vault,
aws-sm). Wires to the existing F8 provider classes for live tests.
"""

from __future__ import annotations

import json
import os
from abc import ABC, abstractmethod
from copy import deepcopy
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal


_VALID_PROVIDERS = frozenset({"file", "vault", "aws-sm"})


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class SecretsProviderConfig:
    provider_id: str
    enabled: bool = True
    config: dict[str, Any] = field(default_factory=dict)
    last_test_at: str | None = None
    last_test_status: Literal["ok", "failed", "unknown"] = "unknown"
    last_test_message: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "SecretsProviderConfig":
        provider_id = str(d.get("provider_id", "")).strip()
        if provider_id not in _VALID_PROVIDERS:
            raise ValueError(f"Invalid provider_id: {provider_id!r}. Valid: {sorted(_VALID_PROVIDERS)}")
        status = str(d.get("last_test_status") or "unknown")
        if status not in ("ok", "failed", "unknown"):
            status = "unknown"
        return cls(
            provider_id=provider_id,
            enabled=bool(d.get("enabled", True)),
            config=dict(d.get("config") or {}),
            last_test_at=d.get("last_test_at"),
            last_test_status=status,  # type: ignore[arg-type]
            last_test_message=d.get("last_test_message"),
        )


class SecretsProvidersConfigStore(ABC):
    """Abstract async store for SecretsProvider connection configs."""

    @abstractmethod
    async def list(self) -> list[SecretsProviderConfig]: ...

    @abstractmethod
    async def get(self, provider_id: str) -> SecretsProviderConfig | None: ...

    @abstractmethod
    async def update(self, provider_id: str, config: dict[str, Any]) -> SecretsProviderConfig: ...

    @abstractmethod
    async def test(self, provider_id: str) -> dict[str, Any]: ...


class InMemorySecretsProvidersConfigStore(SecretsProvidersConfigStore):
    """Dict-backed store for tests."""

    def __init__(self) -> None:
        self._configs: dict[str, SecretsProviderConfig] = {
            pid: SecretsProviderConfig(provider_id=pid)
            for pid in _VALID_PROVIDERS
        }

    async def list(self) -> list[SecretsProviderConfig]:
        return [deepcopy(c) for c in self._configs.values()]

    async def get(self, provider_id: str) -> SecretsProviderConfig | None:
        c = self._configs.get(provider_id)
        return deepcopy(c) if c is not None else None

    async def update(self, provider_id: str, config: dict[str, Any]) -> SecretsProviderConfig:
        existing = self._configs.get(provider_id)
        if existing is None:
            if provider_id not in _VALID_PROVIDERS:
                raise KeyError(f"Unknown secrets provider: {provider_id!r}")
            existing = SecretsProviderConfig(provider_id=provider_id)
        updated = deepcopy(existing)
        updated.config = dict(config)
        self._configs[provider_id] = updated
        return deepcopy(updated)

    async def test(self, provider_id: str) -> dict[str, Any]:
        cfg = self._configs.get(provider_id)
        if cfg is None:
            return {"ok": False, "message": f"Unknown provider: {provider_id!r}"}
        if not cfg.enabled:
            return {"ok": False, "message": f"Provider {provider_id!r} is disabled"}
        result = await _live_test(provider_id, cfg.config)
        now = _utcnow()
        updated = deepcopy(cfg)
        updated.last_test_at = now
        updated.last_test_status = "ok" if result["ok"] else "failed"
        updated.last_test_message = result["message"]
        self._configs[provider_id] = updated
        return result


class FileSecretsProvidersConfigStore(SecretsProvidersConfigStore):
    """JSON-on-disk secrets provider config store.

    Layout: <workspace_root>/.graphcaster/secrets_providers.json
    """

    def __init__(self, workspace_root: Path) -> None:
        self._root = workspace_root

    def _config_path(self) -> Path:
        return self._root / ".graphcaster" / "secrets_providers.json"

    def _load(self) -> dict[str, SecretsProviderConfig]:
        fp = self._config_path()
        if not fp.exists():
            return {pid: SecretsProviderConfig(provider_id=pid) for pid in _VALID_PROVIDERS}
        try:
            raw: dict[str, Any] = json.loads(fp.read_text(encoding="utf-8"))
        except Exception:
            return {pid: SecretsProviderConfig(provider_id=pid) for pid in _VALID_PROVIDERS}
        result: dict[str, SecretsProviderConfig] = {}
        for pid in _VALID_PROVIDERS:
            entry = raw.get(pid)
            if entry and isinstance(entry, dict):
                try:
                    entry["provider_id"] = pid
                    result[pid] = SecretsProviderConfig.from_dict(entry)
                except Exception:
                    result[pid] = SecretsProviderConfig(provider_id=pid)
            else:
                result[pid] = SecretsProviderConfig(provider_id=pid)
        return result

    def _save(self, data: dict[str, SecretsProviderConfig]) -> None:
        fp = self._config_path()
        fp.parent.mkdir(parents=True, exist_ok=True)
        serialized = {pid: c.to_dict() for pid, c in data.items()}
        tmp = fp.with_suffix(".tmp")
        tmp.write_text(json.dumps(serialized, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, fp)

    async def list(self) -> list[SecretsProviderConfig]:
        return list(self._load().values())

    async def get(self, provider_id: str) -> SecretsProviderConfig | None:
        data = self._load()
        return data.get(provider_id)

    async def update(self, provider_id: str, config: dict[str, Any]) -> SecretsProviderConfig:
        if provider_id not in _VALID_PROVIDERS:
            raise KeyError(f"Unknown secrets provider: {provider_id!r}")
        data = self._load()
        existing = data.get(provider_id, SecretsProviderConfig(provider_id=provider_id))
        existing.config = dict(config)
        data[provider_id] = existing
        self._save(data)
        return deepcopy(existing)

    async def test(self, provider_id: str) -> dict[str, Any]:
        data = self._load()
        cfg = data.get(provider_id)
        if cfg is None:
            return {"ok": False, "message": f"Unknown provider: {provider_id!r}"}
        if not cfg.enabled:
            return {"ok": False, "message": f"Provider {provider_id!r} is disabled"}
        result = await _live_test(provider_id, cfg.config)
        now = _utcnow()
        cfg.last_test_at = now
        cfg.last_test_status = "ok" if result["ok"] else "failed"
        cfg.last_test_message = result["message"]
        data[provider_id] = cfg
        self._save(data)
        return result


async def _live_test(provider_id: str, config: dict[str, Any]) -> dict[str, Any]:
    """Attempt a lightweight connectivity check against the provider backend."""
    try:
        if provider_id == "file":
            file_path = config.get("path", "")
            if file_path:
                from pathlib import Path as _Path
                p = _Path(str(file_path))
                if p.exists():
                    return {"ok": True, "message": "Secrets file reachable"}
                return {"ok": False, "message": f"Secrets file not found: {file_path}"}
            return {"ok": True, "message": "File provider ready"}

        if provider_id == "vault":
            vault_addr = config.get("vault_addr") or config.get("vault_url") or os.environ.get("VAULT_ADDR", "")
            if not vault_addr:
                return {"ok": False, "message": "vault_addr not configured"}
            token = config.get("token") or os.environ.get("VAULT_TOKEN", "")
            if not token:
                return {"ok": False, "message": "Vault token not configured"}
            try:
                from graph_caster.secrets.vault_provider import VaultKv2SecretsProvider
                with os.environ.copy() if False else __import__("contextlib").nullcontext():
                    _orig_addr = os.environ.get("VAULT_ADDR")
                    _orig_token = os.environ.get("VAULT_TOKEN")
                    os.environ["VAULT_ADDR"] = vault_addr
                    os.environ["VAULT_TOKEN"] = token
                    try:
                        p = VaultKv2SecretsProvider.from_env()
                        p.as_mapping()
                        return {"ok": True, "message": "Vault reachable"}
                    finally:
                        if _orig_addr is None:
                            os.environ.pop("VAULT_ADDR", None)
                        else:
                            os.environ["VAULT_ADDR"] = _orig_addr
                        if _orig_token is None:
                            os.environ.pop("VAULT_TOKEN", None)
                        else:
                            os.environ["VAULT_TOKEN"] = _orig_token
            except Exception as exc:
                return {"ok": False, "message": str(exc)}

        if provider_id == "aws-sm":
            secret_id = config.get("secret_id") or config.get("secret_name") or os.environ.get("GC_AWS_SECRET_JSON_ID", "")
            if not secret_id:
                return {"ok": False, "message": "secret_id not configured"}
            try:
                from graph_caster.secrets.aws_provider import AwsJsonSecretsProvider
                _orig = os.environ.get("GC_AWS_SECRET_JSON_ID")
                os.environ["GC_AWS_SECRET_JSON_ID"] = secret_id
                if config.get("region"):
                    os.environ["GC_AWS_REGION"] = str(config["region"])
                try:
                    p = AwsJsonSecretsProvider.from_env()
                    p.as_mapping()
                    return {"ok": True, "message": "AWS Secrets Manager reachable"}
                finally:
                    if _orig is None:
                        os.environ.pop("GC_AWS_SECRET_JSON_ID", None)
                    else:
                        os.environ["GC_AWS_SECRET_JSON_ID"] = _orig
            except Exception as exc:
                return {"ok": False, "message": str(exc)}

        return {"ok": False, "message": f"Unknown provider: {provider_id!r}"}
    except Exception as exc:
        return {"ok": False, "message": str(exc)}
