# Copyright GraphCaster. All Rights Reserved.

"""Canonical structured audit event dataclass and JSONL persistence layer."""

from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import hmac
import json
import logging
import os
import secrets
import stat
import threading
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

_LOG = logging.getLogger(__name__)

# Thread-local last hash so concurrent emitters don't corrupt the chain.
# We protect chain-hash writes with a per-process lock so the chain stays valid
# under concurrent writes.
_CHAIN_LOCK = threading.Lock()

# Current MAC version. v1 (or no field) = plain SHA-256 chain; v2 = SHA-256
# chain + HMAC-SHA256 over the same payload, with key sourced from env or file.
_MAC_VERSION_CURRENT = 2

# Workspace-relative path for the auto-generated HMAC key file.
_HMAC_KEY_FILE_RELPATH = Path(".graphcaster") / "audit-hmac.key"

# Warning text — exported for tests that assert the fallback path is logged.
_HMAC_DISABLED_WARNING = "Audit HMAC disabled — chain is detective-only"


@dataclass
class AuditEvent:
    id: str
    timestamp: str
    actor: str
    actor_kind: Literal["user", "service", "system"]
    tenant_id: str
    action: str
    target_kind: str
    target_id: str
    result: Literal["success", "failure"]
    metadata: dict[str, Any] = field(default_factory=dict)
    ip: str | None = None
    user_agent: str | None = None
    prev_hash: str = ""
    entry_hash: str = ""
    # HMAC-SHA256 of the same payload, signed with the workspace audit key.
    # Empty when no signing key is configured. Provides tamper-evidence even
    # against an attacker who can rewrite the entire log file.
    hmac: str = ""
    # Format version: 2 = chain + HMAC; missing/1 = legacy chain only.
    mac_version: int = 0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# Cache: (loaded?, key_bytes_or_None, warned_about_fallback?)
_HMAC_KEY_CACHE: tuple[bool, bytes | None, bool] = (False, None, False)


def _decode_env_key(raw: str) -> bytes | None:
    """Try hex first (must be even length, only [0-9a-f]), then base64."""
    raw = raw.strip()
    if not raw:
        return None
    # hex?
    try:
        if len(raw) % 2 == 0 and all(c in "0123456789abcdefABCDEF" for c in raw):
            decoded = bytes.fromhex(raw)
            if len(decoded) >= 16:
                return decoded
    except (ValueError, binascii.Error):
        pass
    # base64? (urlsafe and standard)
    for variant in (base64.b64decode, base64.urlsafe_b64decode):
        try:
            padded = raw + "=" * (-len(raw) % 4)
            decoded = variant(padded.encode("ascii"))
            if len(decoded) >= 16:
                return decoded
        except (ValueError, binascii.Error):
            continue
    # Fallback: treat as raw utf-8 (must still be reasonably long).
    encoded = raw.encode("utf-8")
    if len(encoded) >= 16:
        return encoded
    return None


def _resolve_workspace_root() -> Path | None:
    """Resolve the workspace root used to locate the HMAC key file.

    Priority:
      1. ``GC_WORKSPACE_ROOT`` env var.
      2. Parent of ``GC_AUDIT_LOG_PATH`` walked up to a ``.graphcaster`` dir
         (or the immediate parent if none is found).
      3. None — caller will fall back to plain SHA-256 chain.
    """
    raw = os.environ.get("GC_WORKSPACE_ROOT", "").strip()
    if raw:
        return Path(raw)
    log_path = os.environ.get("GC_AUDIT_LOG_PATH", "").strip()
    if log_path:
        p = Path(log_path).resolve()
        # Walk up looking for an existing .graphcaster dir; otherwise use the
        # log's directory as the workspace anchor.
        cur: Path | None = p.parent
        seen: set[Path] = set()
        while cur is not None and cur not in seen:
            seen.add(cur)
            if (cur / ".graphcaster").is_dir():
                return cur
            if cur.parent == cur:
                break
            cur = cur.parent
        return p.parent
    return None


def _load_key_from_file(workspace_root: Path) -> bytes | None:
    """Load (or auto-generate on first use) the HMAC key file under workspace.

    The file holds raw random bytes (exactly 32 for auto-generated keys); we do
    NOT strip whitespace because random bytes can legitimately contain ``\\n``
    or ``\\t``. Files larger than 16 bytes are accepted as-is.
    """
    key_path = workspace_root / _HMAC_KEY_FILE_RELPATH
    try:
        if key_path.is_file():
            data = key_path.read_bytes()
            if len(data) >= 16:
                return data
            return None
        # Auto-generate. 256-bit secret.
        key_path.parent.mkdir(parents=True, exist_ok=True)
        new_key = secrets.token_bytes(32)
        # Write atomically: tmp + replace.
        tmp = key_path.with_suffix(".tmp")
        tmp.write_bytes(new_key)
        if os.name == "posix":
            try:
                os.chmod(tmp, stat.S_IRUSR | stat.S_IWUSR)
            except OSError:
                pass
        os.replace(tmp, key_path)
        return new_key
    except OSError:
        _LOG.debug("audit: could not read/create HMAC key file at %s", key_path, exc_info=True)
        return None


def _load_hmac_key() -> bytes | None:
    global _HMAC_KEY_CACHE
    loaded, key, _warned = _HMAC_KEY_CACHE
    if loaded:
        return key

    # 1) env override
    raw = os.environ.get("GC_AUDIT_HMAC_KEY", "").strip()
    if raw:
        decoded = _decode_env_key(raw)
        if decoded is not None:
            _HMAC_KEY_CACHE = (True, decoded, False)
            return decoded
        _LOG.warning("GC_AUDIT_HMAC_KEY set but could not be decoded; falling back")

    # 2) workspace file
    ws = _resolve_workspace_root()
    if ws is not None:
        key_from_file = _load_key_from_file(ws)
        if key_from_file is not None:
            _HMAC_KEY_CACHE = (True, key_from_file, False)
            return key_from_file

    # 3) fallback — warn once
    _LOG.warning(_HMAC_DISABLED_WARNING)
    _HMAC_KEY_CACHE = (True, None, True)
    return None


def _reset_hmac_key_cache() -> None:
    global _HMAC_KEY_CACHE
    _HMAC_KEY_CACHE = (False, None, False)


# Fields that are NOT part of the signed payload (they ARE the signature/hash
# or version metadata about it). Listed here so the canonical serialisation is
# stable across additions to the dataclass.
_NON_PAYLOAD_FIELDS = ("entry_hash", "hmac", "entry_hmac", "mac_version")


def _canonical_payload_bytes(event_dict: dict[str, Any]) -> bytes:
    d = {k: v for k, v in event_dict.items() if k not in _NON_PAYLOAD_FIELDS}
    return json.dumps(d, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()


def _compute_entry_hash(event_dict: dict[str, Any]) -> str:
    """SHA-256 over the JSON-serialised event (excluding hash/hmac/version)."""
    return hashlib.sha256(_canonical_payload_bytes(event_dict)).hexdigest()


def _compute_entry_hmac(event_dict: dict[str, Any], key: bytes) -> str:
    return hmac.new(key, _canonical_payload_bytes(event_dict), hashlib.sha256).hexdigest()


def _audit_log_path() -> Path | None:
    raw = os.environ.get("GC_AUDIT_LOG_PATH", "").strip()
    if raw:
        return Path(raw)
    return None


def _make_event(
    *,
    action: str,
    actor: str = "system",
    actor_kind: Literal["user", "service", "system"] = "system",
    tenant_id: str = "default",
    target_kind: str = "",
    target_id: str = "",
    result: Literal["success", "failure"] = "success",
    metadata: dict[str, Any] | None = None,
    ip: str | None = None,
    user_agent: str | None = None,
) -> AuditEvent:
    return AuditEvent(
        id=str(uuid.uuid4()),
        timestamp=datetime.now(timezone.utc).isoformat(),
        actor=actor,
        actor_kind=actor_kind,
        tenant_id=tenant_id,
        action=action,
        target_kind=target_kind,
        target_id=target_id,
        result=result,
        metadata=metadata or {},
        ip=ip,
        user_agent=user_agent,
    )


# ---- module-level last_hash for chain (protected by _CHAIN_LOCK) ----
_last_hash: str = ""


def emit(
    *,
    action: str,
    actor: str = "system",
    actor_kind: Literal["user", "service", "system"] = "system",
    tenant_id: str = "default",
    target_kind: str = "",
    target_id: str = "",
    result: Literal["success", "failure"] = "success",
    metadata: dict[str, Any] | None = None,
    ip: str | None = None,
    user_agent: str | None = None,
) -> None:
    """Append a canonical audit event to the JSONL log.

    Never raises — all errors are swallowed and logged at DEBUG level.
    """
    try:
        _emit_inner(
            action=action,
            actor=actor,
            actor_kind=actor_kind,
            tenant_id=tenant_id,
            target_kind=target_kind,
            target_id=target_id,
            result=result,
            metadata=metadata,
            ip=ip,
            user_agent=user_agent,
        )
    except Exception:
        _LOG.debug("audit emit failed", exc_info=True)


async def emit_async(
    *,
    action: str,
    actor: str = "system",
    actor_kind: Literal["user", "service", "system"] = "system",
    tenant_id: str = "default",
    target_kind: str = "",
    target_id: str = "",
    result: Literal["success", "failure"] = "success",
    metadata: dict[str, Any] | None = None,
    ip: str | None = None,
    user_agent: str | None = None,
) -> None:
    """Async wrapper — runs emit() in a thread-pool so the event loop is not blocked."""
    try:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(
            None,
            lambda: _emit_inner(
                action=action,
                actor=actor,
                actor_kind=actor_kind,
                tenant_id=tenant_id,
                target_kind=target_kind,
                target_id=target_id,
                result=result,
                metadata=metadata,
                ip=ip,
                user_agent=user_agent,
            ),
        )
    except Exception:
        _LOG.debug("audit emit_async failed", exc_info=True)


def _emit_inner(
    *,
    action: str,
    actor: str,
    actor_kind: Literal["user", "service", "system"],
    tenant_id: str,
    target_kind: str,
    target_id: str,
    result: Literal["success", "failure"],
    metadata: dict[str, Any] | None,
    ip: str | None,
    user_agent: str | None,
) -> None:
    global _last_hash

    path = _audit_log_path()
    if path is None:
        # Also bump Prometheus counter even when no file is configured
        _bump_prometheus(action, result)
        return

    ev = _make_event(
        action=action,
        actor=actor,
        actor_kind=actor_kind,
        tenant_id=tenant_id,
        target_kind=target_kind,
        target_id=target_id,
        result=result,
        metadata=metadata,
        ip=ip,
        user_agent=user_agent,
    )

    with _CHAIN_LOCK:
        ev.prev_hash = _last_hash
        ev.entry_hash = _compute_entry_hash(ev.to_dict())
        key = _load_hmac_key()
        if key is not None:
            ev.hmac = _compute_entry_hmac(ev.to_dict(), key)
            ev.mac_version = _MAC_VERSION_CURRENT
        else:
            ev.mac_version = 0
        _last_hash = ev.entry_hash

        path.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps(ev.to_dict(), ensure_ascii=False, separators=(",", ":")) + "\n"
        with path.open("a", encoding="utf-8") as f:
            f.write(line)

    _bump_prometheus(action, result)


# ---- Prometheus counters ----

_PROM_EVENTS: dict[str, int] = {}
_PROM_QUERY_CALLS: int = 0


def _bump_prometheus(action: str, result: str) -> None:
    key = f"{action}|{result}"
    _PROM_EVENTS[key] = _PROM_EVENTS.get(key, 0) + 1


def prometheus_lines() -> str:
    lines = [
        "# HELP gc_audit_events_total Total audit events emitted.",
        "# TYPE gc_audit_events_total counter",
    ]
    for key, val in _PROM_EVENTS.items():
        action, result = key.split("|", 1)
        lines.append(f'gc_audit_events_total{{action="{action}",result="{result}"}} {val}')
    lines += [
        "# HELP gc_audit_query_calls_total Total audit query calls.",
        "# TYPE gc_audit_query_calls_total counter",
        f"gc_audit_query_calls_total {_PROM_QUERY_CALLS}",
    ]
    return "\n".join(lines) + "\n"


def _bump_query_counter() -> None:
    global _PROM_QUERY_CALLS
    _PROM_QUERY_CALLS += 1


# ---- reset helpers (for tests) ----

def _reset_state(*, last_hash: str = "") -> None:
    global _last_hash, _PROM_QUERY_CALLS
    _last_hash = last_hash
    _PROM_EVENTS.clear()
    _PROM_QUERY_CALLS = 0
    _reset_hmac_key_cache()


def verify_chain(path: Path) -> tuple[bool, int, str | None]:
    """Re-walk a JSONL audit log and verify SHA-256 chain and optional HMAC.

    Returns (ok, lines_checked, first_bad_line_id). Handles both legacy entries
    (no ``mac_version`` field — verified with SHA-256 chain only) and v2 entries
    (verified with SHA-256 chain plus HMAC).
    """
    key = _load_hmac_key()
    prev = ""
    checked = 0
    try:
        with path.open("r", encoding="utf-8") as f:
            for raw in f:
                raw = raw.strip()
                if not raw:
                    continue
                checked += 1
                try:
                    d = json.loads(raw)
                except json.JSONDecodeError:
                    return False, checked, "<malformed-json>"
                if not isinstance(d, dict):
                    return False, checked, "<not-an-object>"
                if d.get("prev_hash", "") != prev:
                    return False, checked, str(d.get("id", "<no-id>"))
                expected_hash = _compute_entry_hash(d)
                if d.get("entry_hash") != expected_hash:
                    return False, checked, str(d.get("id", "<no-id>"))
                mv = int(d.get("mac_version") or 0)
                if mv >= 2:
                    # v2 entry — HMAC required.
                    if key is None:
                        # Can't verify v2 entry without the key — treat as failure.
                        return False, checked, str(d.get("id", "<no-id>"))
                    expected_hmac = _compute_entry_hmac(d, key)
                    if d.get("hmac") != expected_hmac:
                        return False, checked, str(d.get("id", "<no-id>"))
                # v1 / legacy: SHA-256 chain only, no HMAC check.
                prev = expected_hash
    except OSError:
        return False, checked, "<read-error>"
    return True, checked, None
