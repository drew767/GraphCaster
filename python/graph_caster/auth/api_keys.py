# Copyright GraphCaster. All Rights Reserved.

"""API key store for user-scoped, file-backed API keys with scrypt hashing."""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import threading
import time
import uuid
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


_KID_PREFIX = "gc_"

# scrypt parameters. Bumped from n=2048 to n=16384 to match tenancy/service.py.
# Legacy short-form hashes (no params prefix) verify with the historical n=2048
# parameters; on a successful verify the store opportunistically rehashes with
# the new parameters and persists, transparent to callers.
_SCRYPT_N = 16384
_SCRYPT_R = 8
_SCRYPT_P = 1
_SCRYPT_LEGACY_N = 2048
_SCRYPT_LEGACY_R = 8
_SCRYPT_LEGACY_P = 1
_HASH_PREFIX = "scrypt"


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hash_raw_key(raw_key: str) -> str:
    """Derive a stored hash using scrypt with a random salt.

    Format: ``scrypt$n=<n>$r=<r>$p=<p>$<salt_hex>$<dk_hex>``.
    """
    salt = os.urandom(16)
    dk = hashlib.scrypt(
        raw_key.encode("utf-8"), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P
    )
    return (
        f"{_HASH_PREFIX}$n={_SCRYPT_N}$r={_SCRYPT_R}$p={_SCRYPT_P}$"
        f"{salt.hex()}${dk.hex()}"
    )


def _parse_stored_hash(stored_hash: str) -> tuple[int, int, int, bytes, bytes] | None:
    """Return (n, r, p, salt, dk) for either the new prefixed format or the
    legacy ``salt_hex:dk_hex`` short form. Returns ``None`` on malformed input.
    """
    try:
        if stored_hash.startswith(_HASH_PREFIX + "$"):
            parts = stored_hash.split("$")
            # ["scrypt", "n=<n>", "r=<r>", "p=<p>", "<salt_hex>", "<dk_hex>"]
            if len(parts) != 6:
                return None
            n = int(parts[1].split("=", 1)[1])
            r = int(parts[2].split("=", 1)[1])
            p = int(parts[3].split("=", 1)[1])
            salt = bytes.fromhex(parts[4])
            dk = bytes.fromhex(parts[5])
            return n, r, p, salt, dk
        # Legacy format: "<salt_hex>:<dk_hex>" with the historical n=2048.
        salt_hex, dk_hex = stored_hash.split(":", 1)
        return (
            _SCRYPT_LEGACY_N,
            _SCRYPT_LEGACY_R,
            _SCRYPT_LEGACY_P,
            bytes.fromhex(salt_hex),
            bytes.fromhex(dk_hex),
        )
    except (ValueError, AttributeError, IndexError):
        return None


def _verify_raw_key(raw_key: str, stored_hash: str) -> tuple[bool, bool]:
    """Verify *raw_key* against *stored_hash*.

    Returns ``(ok, needs_rehash)``. ``needs_rehash`` is ``True`` when the
    stored hash used legacy (weak) parameters and a successful verify should
    trigger opportunistic re-hashing with the current parameters.
    """
    parsed = _parse_stored_hash(stored_hash)
    if parsed is None:
        return False, False
    n, r, p, salt, expected = parsed
    try:
        dk = hashlib.scrypt(raw_key.encode("utf-8"), salt=salt, n=n, r=r, p=p)
    except ValueError:
        return False, False
    ok = secrets.compare_digest(dk, expected)
    needs_rehash = ok and (n, r, p) != (_SCRYPT_N, _SCRYPT_R, _SCRYPT_P)
    return ok, needs_rehash


class RateLimited(Exception):
    """Raised when a verify source has exceeded the failure rate limit.

    Attributes:
        retry_after_sec: Seconds the caller should wait before retrying.
        source: The opaque source identifier (e.g., remote IP) being limited.
    """

    def __init__(self, retry_after_sec: float, source: str = "") -> None:
        self.retry_after_sec = max(0.0, float(retry_after_sec))
        self.source = source
        super().__init__(
            f"verify rate-limited for source {source!r}; retry after "
            f"{self.retry_after_sec:.1f}s"
        )


class _VerifyRateLimiter:
    """In-memory fixed-window failure counter with exponential backoff.

    After ``max_failures`` failed attempts inside ``window_sec``, the source is
    locked out for an interval that doubles each consecutive lockout (capped at
    ``max_lockout_sec``). A successful verify clears the counter and any
    pending lockout for that source.
    """

    def __init__(
        self,
        *,
        max_failures: int = 10,
        window_sec: float = 60.0,
        initial_lockout_sec: float = 60.0,
        max_lockout_sec: float = 300.0,
        clock: Any = time.monotonic,
    ) -> None:
        self._max_failures = int(max_failures)
        self._window_sec = float(window_sec)
        self._initial_lockout_sec = float(initial_lockout_sec)
        self._max_lockout_sec = float(max_lockout_sec)
        self._clock = clock
        self._lock = threading.Lock()
        # source -> {"fails": int, "window_start": float, "locked_until": float, "streak": int}
        self._state: dict[str, dict[str, float]] = {}

    def _bucket(self, source: str) -> dict[str, float]:
        b = self._state.get(source)
        if b is None:
            b = {"fails": 0.0, "window_start": 0.0, "locked_until": 0.0, "streak": 0.0}
            self._state[source] = b
        return b

    def check(self, source: str) -> None:
        """Raise :class:`RateLimited` if *source* is currently locked out."""
        now = float(self._clock())
        with self._lock:
            b = self._bucket(source)
            if b["locked_until"] > now:
                raise RateLimited(b["locked_until"] - now, source)

    def record_failure(self, source: str) -> None:
        """Record a failed verify; lock the source out if the window quota is hit."""
        now = float(self._clock())
        with self._lock:
            b = self._bucket(source)
            if b["locked_until"] > now:
                # Already locked; nothing to do.
                return
            if now - b["window_start"] >= self._window_sec:
                b["window_start"] = now
                b["fails"] = 0.0
            b["fails"] += 1.0
            if b["fails"] >= self._max_failures:
                streak = b["streak"] + 1.0
                b["streak"] = streak
                lockout = min(
                    self._initial_lockout_sec * (2.0 ** (streak - 1.0)),
                    self._max_lockout_sec,
                )
                b["locked_until"] = now + lockout
                b["fails"] = 0.0
                b["window_start"] = now

    def record_success(self, source: str) -> None:
        """Clear all failure state for *source*."""
        with self._lock:
            self._state.pop(source, None)

    def reset(self) -> None:
        with self._lock:
            self._state.clear()


@dataclass
class ApiKeyRecord:
    id: str
    user_id: str
    tenant_id: str
    label: str
    key_hash: str
    scopes: list[str]
    created_at: str
    last_used_at: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def public_dict(self) -> dict[str, Any]:
        """Dict safe to return to clients (no key_hash)."""
        d = self.to_dict()
        d.pop("key_hash", None)
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "ApiKeyRecord":
        return cls(
            id=d["id"],
            user_id=d["user_id"],
            tenant_id=d["tenant_id"],
            label=d["label"],
            key_hash=d["key_hash"],
            scopes=list(d.get("scopes", [])),
            created_at=d["created_at"],
            last_used_at=d.get("last_used_at"),
        )


class ApiKeyStore:
    """File-backed API key store (.graphcaster/api-keys/<tenant>/<kid>.json)."""

    def __init__(
        self,
        workspace_root: Path | None = None,
        *,
        rate_limiter: _VerifyRateLimiter | None = None,
    ) -> None:
        self._root = workspace_root
        self._rate_limiter = rate_limiter if rate_limiter is not None else _VerifyRateLimiter()

    @property
    def rate_limiter(self) -> _VerifyRateLimiter:
        return self._rate_limiter

    def _tenant_dir(self, tenant_id: str) -> Path:
        base = self._root if self._root is not None else Path(".")
        d = base / ".graphcaster" / "api-keys" / tenant_id
        d.mkdir(parents=True, exist_ok=True)
        return d

    def _path(self, tenant_id: str, kid: str) -> Path:
        return self._tenant_dir(tenant_id) / f"{kid}.json"

    def _save(self, rec: ApiKeyRecord) -> None:
        path = self._path(rec.tenant_id, rec.id)
        path.write_text(json.dumps(rec.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")

    def _load(self, tenant_id: str, kid: str) -> ApiKeyRecord | None:
        path = self._path(tenant_id, kid)
        if not path.exists():
            return None
        return ApiKeyRecord.from_dict(json.loads(path.read_text(encoding="utf-8")))

    async def create(
        self,
        user_id: str,
        tenant_id: str,
        label: str,
        scopes: list[str],
    ) -> tuple[ApiKeyRecord, str]:
        """Create a new API key. Returns (record, raw_key). raw_key shown once."""
        raw_key = _KID_PREFIX + secrets.token_urlsafe(32)
        kid = _KID_PREFIX + uuid.uuid4().hex[:16]
        now = _utcnow()
        rec = ApiKeyRecord(
            id=kid,
            user_id=user_id,
            tenant_id=tenant_id,
            label=label,
            key_hash=_hash_raw_key(raw_key),
            scopes=list(scopes),
            created_at=now,
        )
        self._save(rec)
        return rec, raw_key

    async def list(self, user_id: str, tenant_id: str) -> list[ApiKeyRecord]:
        d = self._tenant_dir(tenant_id)
        results: list[ApiKeyRecord] = []
        for p in sorted(d.glob("*.json")):
            try:
                rec = ApiKeyRecord.from_dict(json.loads(p.read_text(encoding="utf-8")))
            except Exception:
                continue
            if rec.user_id == user_id:
                results.append(rec)
        return results

    async def verify(
        self, raw_key: str, *, source: str | None = None
    ) -> ApiKeyRecord | None:
        """Authenticate a raw key. Iterates all tenants — use for middleware only.

        *source* is an opaque key (e.g., remote IP) used by the failure rate
        limiter. Falls back to ``"global"`` when not provided. On lockout this
        method raises :class:`RateLimited`. A successful verify resets the
        failure counter for *source*. If the matched record uses legacy scrypt
        params the hash is opportunistically re-hashed and persisted.
        """
        src = source if source else "global"
        self._rate_limiter.check(src)

        base = self._root if self._root is not None else Path(".")
        api_keys_root = base / ".graphcaster" / "api-keys"
        if not api_keys_root.exists():
            self._rate_limiter.record_failure(src)
            return None
        for tenant_dir in sorted(api_keys_root.iterdir()):
            if not tenant_dir.is_dir():
                continue
            for p in sorted(tenant_dir.glob("*.json")):
                try:
                    rec = ApiKeyRecord.from_dict(json.loads(p.read_text(encoding="utf-8")))
                except Exception:
                    continue
                ok, needs_rehash = _verify_raw_key(raw_key, rec.key_hash)
                if ok:
                    if needs_rehash:
                        try:
                            rec.key_hash = _hash_raw_key(raw_key)
                            self._save(rec)
                        except OSError:
                            # Re-hash is best-effort; verify still succeeds.
                            pass
                    self._rate_limiter.record_success(src)
                    return rec
        self._rate_limiter.record_failure(src)
        return None

    async def revoke(self, kid: str, user_id: str, tenant_id: str) -> None:
        rec = self._load(tenant_id, kid)
        if rec is None:
            return
        if rec.user_id != user_id:
            raise PermissionError(f"Key {kid!r} does not belong to user {user_id!r}")
        path = self._path(tenant_id, kid)
        if path.exists():
            path.unlink()

    async def touch_last_used(self, kid: str, tenant_id: str) -> None:
        rec = self._load(tenant_id, kid)
        if rec is None:
            return
        rec.last_used_at = _utcnow()
        self._save(rec)

    async def get(self, kid: str, tenant_id: str) -> ApiKeyRecord | None:
        return self._load(tenant_id, kid)


def parse_env_api_keys(env_value: str) -> list[tuple[str, str, list[str]]]:
    """Parse GC_RUN_BROKER_V1_API_KEYS format: kid:secret[:scope1,scope2].

    Returns list of (kid, secret, scopes).
    """
    results: list[tuple[str, str, list[str]]] = []
    for entry in env_value.split(","):
        entry = entry.strip()
        if not entry:
            continue
        parts = entry.split(":")
        if len(parts) < 2:
            continue
        kid = parts[0].strip()
        secret = parts[1].strip()
        if len(parts) >= 3:
            scopes = [s.strip() for s in parts[2].split() if s.strip()]
        else:
            scopes = ["run:execute", "run:view", "run:cancel"]
        if kid and secret:
            results.append((kid, secret, scopes))
    return results
