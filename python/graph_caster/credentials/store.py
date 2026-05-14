# Copyright GraphCaster. All Rights Reserved.

"""Credential store (F8 integration): file-backed with field-level encryption."""

from __future__ import annotations

import base64
import hashlib
import json
import os
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


_SENSITIVE_FIELDS = frozenset(
    {
        "api_key", "secret", "password", "token", "access_token",
        "secret_key", "client_secret", "private_key", "passphrase",
    }
)

_VALID_TYPES = frozenset(
    {
        "openai", "anthropic", "slack", "github", "api-key",
        "basic-auth", "bearer", "aws", "database", "custom",
    }
)


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _workspace_key(workspace_root: Path | None) -> bytes:
    """Derive a 32-byte AES key from the workspace path (or a default env key)."""
    raw = os.environ.get("GC_CREDENTIAL_ENCRYPTION_KEY", "").strip()
    if raw:
        return hashlib.sha256(raw.encode()).digest()
    if workspace_root is not None:
        seed = str(workspace_root.resolve())
    else:
        seed = "graphcaster-default-credential-key"
    return hashlib.sha256(seed.encode()).digest()


def _xor_encrypt(data: bytes, key: bytes) -> bytes:
    """XOR-based symmetric cipher (key-stream repeating). Deterministic, no IV."""
    out = bytearray(len(data))
    for i, b in enumerate(data):
        out[i] = b ^ key[i % len(key)]
    return bytes(out)


def _encrypt_field(plaintext: str, key: bytes) -> str:
    """Encrypt a sensitive field value; returns a base64-encoded opaque blob."""
    ct = _xor_encrypt(plaintext.encode("utf-8"), key)
    return "enc:" + base64.b64encode(ct).decode()


def _decrypt_field(ciphertext: str, key: bytes) -> str:
    """Decrypt a field that was encrypted with _encrypt_field."""
    if not ciphertext.startswith("enc:"):
        return ciphertext
    raw = base64.b64decode(ciphertext[4:])
    return _xor_encrypt(raw, key).decode("utf-8")


@dataclass
class CredentialRecord:
    id: str
    tenant_id: str
    name: str
    type: str
    description: str = ""
    provider: str = "file"
    fields: dict[str, Any] = field(default_factory=dict)
    created_at: str = ""
    updated_at: str = ""
    last_used_at: str | None = None
    used_by_workflows: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def public_dict(self) -> dict[str, Any]:
        """Return record dict with sensitive field values masked."""
        d = self.to_dict()
        masked: dict[str, Any] = {}
        for k, v in d.get("fields", {}).items():
            if k in _SENSITIVE_FIELDS:
                masked[k] = "***"
            else:
                masked[k] = v
        d["fields"] = masked
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "CredentialRecord":
        return cls(
            id=d["id"],
            tenant_id=d["tenant_id"],
            name=d["name"],
            type=d["type"],
            description=str(d.get("description", "")),
            provider=str(d.get("provider", "file")),
            fields=dict(d.get("fields", {})),
            created_at=str(d.get("created_at", "")),
            updated_at=str(d.get("updated_at", "")),
            last_used_at=d.get("last_used_at"),
            used_by_workflows=list(d.get("used_by_workflows", [])),
        )


class CredentialStore:
    """File-backed credential store (.graphcaster/credentials/<tenant>/<id>.json).

    Sensitive fields are encrypted with a workspace-derived key.
    """

    def __init__(self, workspace_root: Path | None = None) -> None:
        self._root = workspace_root
        self._key = _workspace_key(workspace_root)

    def _tenant_dir(self, tenant_id: str) -> Path:
        base = self._root if self._root is not None else Path(".")
        d = base / ".graphcaster" / "credentials" / tenant_id
        d.mkdir(parents=True, exist_ok=True)
        return d

    def _path(self, tenant_id: str, cred_id: str) -> Path:
        return self._tenant_dir(tenant_id) / f"{cred_id}.json"

    def _encrypt_fields(self, fields: dict[str, Any]) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for k, v in fields.items():
            if k in _SENSITIVE_FIELDS and isinstance(v, str):
                out[k] = _encrypt_field(v, self._key)
            else:
                out[k] = v
        return out

    def _decrypt_fields(self, fields: dict[str, Any]) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for k, v in fields.items():
            if k in _SENSITIVE_FIELDS and isinstance(v, str) and v.startswith("enc:"):
                out[k] = _decrypt_field(v, self._key)
            else:
                out[k] = v
        return out

    def _save(self, rec: CredentialRecord) -> None:
        data = rec.to_dict()
        path = self._path(rec.tenant_id, rec.id)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def _load(self, tenant_id: str, cred_id: str) -> CredentialRecord | None:
        path = self._path(tenant_id, cred_id)
        if not path.exists():
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
        rec = CredentialRecord.from_dict(data)
        rec.fields = self._decrypt_fields(rec.fields)
        return rec

    async def create(
        self,
        tenant_id: str,
        name: str,
        type: str,
        fields: dict[str, Any],
        description: str = "",
        provider: str = "file",
    ) -> CredentialRecord:
        if type not in _VALID_TYPES:
            raise ValueError(f"Invalid credential type {type!r}. Valid: {sorted(_VALID_TYPES)}")
        now = _utcnow()
        rec = CredentialRecord(
            id=str(uuid.uuid4()),
            tenant_id=tenant_id,
            name=name,
            type=type,
            description=description,
            provider=provider,
            fields=self._encrypt_fields(fields),
            created_at=now,
            updated_at=now,
        )
        self._save(rec)
        rec.fields = self._decrypt_fields(rec.fields)
        return rec

    async def get(self, cred_id: str, tenant_id: str) -> CredentialRecord | None:
        return self._load(tenant_id, cred_id)

    async def list(
        self,
        tenant_id: str,
        *,
        type_filter: str | None = None,
        search: str | None = None,
    ) -> list[CredentialRecord]:
        d = self._tenant_dir(tenant_id)
        results: list[CredentialRecord] = []
        for p in sorted(d.glob("*.json")):
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
                rec = CredentialRecord.from_dict(data)
                rec.fields = self._decrypt_fields(rec.fields)
            except Exception:
                continue
            if type_filter and rec.type != type_filter:
                continue
            if search:
                q = search.lower()
                if q not in rec.name.lower() and q not in rec.description.lower():
                    continue
            results.append(rec)
        return results

    async def update(
        self, cred_id: str, tenant_id: str, patch: dict[str, Any]
    ) -> CredentialRecord:
        rec = self._load(tenant_id, cred_id)
        if rec is None:
            raise KeyError(f"Credential {cred_id!r} not found for tenant {tenant_id!r}")
        if "name" in patch:
            rec.name = str(patch["name"])
        if "description" in patch:
            rec.description = str(patch["description"])
        if "fields" in patch:
            merged = {**rec.fields, **patch["fields"]}
            rec.fields = merged
        if "provider" in patch:
            rec.provider = str(patch["provider"])
        rec.updated_at = _utcnow()
        rec.fields = self._encrypt_fields(rec.fields)
        self._save(rec)
        rec.fields = self._decrypt_fields(rec.fields)
        return rec

    async def delete(self, cred_id: str, tenant_id: str) -> None:
        path = self._path(tenant_id, cred_id)
        if path.exists():
            path.unlink()

    async def test(self, cred_id: str, tenant_id: str) -> dict[str, Any]:
        """Type-specific connectivity test. Returns {"ok": bool, "message": str}."""
        rec = self._load(tenant_id, cred_id)
        if rec is None:
            raise KeyError(f"Credential {cred_id!r} not found for tenant {tenant_id!r}")
        return await _run_connection_test(rec)

    async def get_used_by_workflows(self, cred_id: str, tenant_id: str) -> list[str]:
        rec = self._load(tenant_id, cred_id)
        if rec is None:
            return []
        return list(rec.used_by_workflows)

    async def mark_used_by(self, cred_id: str, tenant_id: str, workflow_id: str) -> None:
        """Record that a workflow references this credential."""
        rec = self._load(tenant_id, cred_id)
        if rec is None:
            return
        if workflow_id not in rec.used_by_workflows:
            rec.used_by_workflows.append(workflow_id)
        rec.last_used_at = _utcnow()
        rec.fields = self._encrypt_fields(rec.fields)
        self._save(rec)


async def _run_connection_test(rec: CredentialRecord) -> dict[str, Any]:
    """Dispatch to a type-specific tester. All failures are caught."""
    try:
        if rec.type == "openai":
            return await _test_openai(rec.fields)
        if rec.type == "anthropic":
            return await _test_anthropic(rec.fields)
        if rec.type == "slack":
            return await _test_slack(rec.fields)
        if rec.type == "github":
            return await _test_github(rec.fields)
        if rec.type in ("api-key", "bearer"):
            key = rec.fields.get("api_key") or rec.fields.get("token", "")
            if not key:
                return {"ok": False, "message": "No API key/token configured"}
            return {"ok": True, "message": "Key is present (format not verified)"}
        if rec.type == "basic-auth":
            user = rec.fields.get("username", "")
            pw = rec.fields.get("password", "")
            if not user or not pw:
                return {"ok": False, "message": "username or password missing"}
            return {"ok": True, "message": "Credentials present (not verified against a service)"}
        if rec.type == "aws":
            ak = rec.fields.get("access_key_id", "")
            sk = rec.fields.get("secret_key") or rec.fields.get("secret_access_key", "")
            if not ak or not sk:
                return {"ok": False, "message": "access_key_id or secret_key missing"}
            return {"ok": True, "message": "AWS credentials present (not verified)"}
        if rec.type == "database":
            url = rec.fields.get("url") or rec.fields.get("connection_string", "")
            if not url:
                return {"ok": False, "message": "No connection URL configured"}
            return {"ok": True, "message": "Connection URL present (not verified)"}
        return {"ok": True, "message": f"No test defined for type {rec.type!r}; fields present"}
    except Exception as exc:
        return {"ok": False, "message": str(exc)}


async def _test_openai(fields: dict[str, Any]) -> dict[str, Any]:
    api_key = fields.get("api_key", "")
    if not api_key:
        return {"ok": False, "message": "api_key not configured"}
    try:
        import urllib.request
        req = urllib.request.Request(
            "https://api.openai.com/v1/models",
            headers={"Authorization": f"Bearer {api_key}"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status == 200:
                return {"ok": True, "message": "OpenAI API key is valid"}
            return {"ok": False, "message": f"HTTP {resp.status}"}
    except Exception as exc:
        return {"ok": False, "message": str(exc)}


async def _test_anthropic(fields: dict[str, Any]) -> dict[str, Any]:
    api_key = fields.get("api_key", "")
    if not api_key:
        return {"ok": False, "message": "api_key not configured"}
    try:
        import urllib.request
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/models",
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
            },
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status == 200:
                return {"ok": True, "message": "Anthropic API key is valid"}
            return {"ok": False, "message": f"HTTP {resp.status}"}
    except Exception as exc:
        return {"ok": False, "message": str(exc)}


async def _test_slack(fields: dict[str, Any]) -> dict[str, Any]:
    token = fields.get("token") or fields.get("api_key", "")
    if not token:
        return {"ok": False, "message": "token not configured"}
    try:
        import urllib.request
        req = urllib.request.Request(
            "https://slack.com/api/auth.test",
            headers={"Authorization": f"Bearer {token}"},
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = json.loads(resp.read().decode())
            if body.get("ok"):
                return {"ok": True, "message": f"Slack token valid; team={body.get('team', '?')}"}
            return {"ok": False, "message": body.get("error", "unknown")}
    except Exception as exc:
        return {"ok": False, "message": str(exc)}


async def _test_github(fields: dict[str, Any]) -> dict[str, Any]:
    token = fields.get("token") or fields.get("api_key", "")
    if not token:
        return {"ok": False, "message": "token not configured"}
    try:
        import urllib.request
        req = urllib.request.Request(
            "https://api.github.com/user",
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/vnd.github+json",
            },
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status == 200:
                body = json.loads(resp.read().decode())
                return {"ok": True, "message": f"GitHub token valid; login={body.get('login', '?')}"}
            return {"ok": False, "message": f"HTTP {resp.status}"}
    except Exception as exc:
        return {"ok": False, "message": str(exc)}
