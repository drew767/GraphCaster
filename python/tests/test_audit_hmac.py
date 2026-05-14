# Copyright GraphCaster. All Rights Reserved.

"""Tests for HMAC-signed audit log entries (mac_version=2)."""

from __future__ import annotations

import base64
import json
import logging
import os
import stat
from pathlib import Path

import pytest

from graph_caster.audit.audit_event import (
    _HMAC_DISABLED_WARNING,
    _HMAC_KEY_FILE_RELPATH,
    _compute_entry_hash,
    _compute_entry_hmac,
    _load_hmac_key,
    _reset_state,
    emit,
    verify_chain,
)


def _setup_env(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, *, with_workspace: bool = True
) -> Path:
    """Configure GC_AUDIT_LOG_PATH (and optional workspace root) for one test."""
    log = tmp_path / "audit.jsonl"
    monkeypatch.setenv("GC_AUDIT_LOG_PATH", str(log))
    if with_workspace:
        monkeypatch.setenv("GC_WORKSPACE_ROOT", str(tmp_path))
    else:
        monkeypatch.delenv("GC_WORKSPACE_ROOT", raising=False)
    monkeypatch.delenv("GC_AUDIT_HMAC_KEY", raising=False)
    _reset_state()
    return log


# ---------------------------------------------------------------------------
# Key sourcing & priority
# ---------------------------------------------------------------------------


def test_env_hmac_key_hex_decodes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _setup_env(tmp_path, monkeypatch, with_workspace=False)
    hex_key = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff"
    monkeypatch.setenv("GC_AUDIT_HMAC_KEY", hex_key)
    _reset_state()
    key = _load_hmac_key()
    assert key == bytes.fromhex(hex_key)


def test_env_hmac_key_base64_decodes(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _setup_env(tmp_path, monkeypatch, with_workspace=False)
    raw = b"\x01" * 32
    b64 = base64.b64encode(raw).decode("ascii")
    monkeypatch.setenv("GC_AUDIT_HMAC_KEY", b64)
    _reset_state()
    assert _load_hmac_key() == raw


def test_env_overrides_workspace_key_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Put a workspace key file in place — env should still win.
    ws_key_path = tmp_path / _HMAC_KEY_FILE_RELPATH
    ws_key_path.parent.mkdir(parents=True, exist_ok=True)
    ws_key_path.write_bytes(b"file-key-not-used-because-env-wins-12345")

    _setup_env(tmp_path, monkeypatch)
    env_key_hex = "ab" * 32
    monkeypatch.setenv("GC_AUDIT_HMAC_KEY", env_key_hex)
    _reset_state()

    assert _load_hmac_key() == bytes.fromhex(env_key_hex)


def test_workspace_key_file_auto_generated(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _setup_env(tmp_path, monkeypatch)
    key_path = tmp_path / _HMAC_KEY_FILE_RELPATH
    assert not key_path.exists()

    k = _load_hmac_key()
    assert k is not None
    assert len(k) == 32
    assert key_path.is_file()
    # File content matches the cached key (raw bytes — no surrounding whitespace).
    assert key_path.read_bytes() == k


@pytest.mark.skipif(os.name != "posix", reason="POSIX-only permission check")
def test_workspace_key_file_has_0600_on_posix(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _setup_env(tmp_path, monkeypatch)
    _load_hmac_key()
    key_path = tmp_path / _HMAC_KEY_FILE_RELPATH
    mode = stat.S_IMODE(key_path.stat().st_mode)
    # 0o600 — owner read/write only.
    assert mode == 0o600, f"expected 0600, got {oct(mode)}"


def test_workspace_key_file_persists_across_calls(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _setup_env(tmp_path, monkeypatch)
    k1 = _load_hmac_key()
    _reset_state()
    k2 = _load_hmac_key()
    assert k1 == k2


def test_fallback_logs_warning(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    # No env, no workspace -> fallback to plain SHA-256 chain with WARN.
    log = tmp_path / "audit.jsonl"
    monkeypatch.setenv("GC_AUDIT_LOG_PATH", str(log))
    monkeypatch.delenv("GC_AUDIT_HMAC_KEY", raising=False)
    monkeypatch.delenv("GC_WORKSPACE_ROOT", raising=False)
    _reset_state()

    with caplog.at_level(logging.WARNING, logger="graph_caster.audit.audit_event"):
        # Force key resolution from a directory with no .graphcaster anywhere by
        # pointing the log into a tmp path; workspace resolution returns
        # tmp_path itself (the log's parent), which has no .graphcaster — but
        # since the key file is auto-generated, fallback only happens if the
        # workspace path cannot be created. Use an unwritable target.
        # Easiest: set GC_WORKSPACE_ROOT to a path where mkdir will fail.
        bad_root = tmp_path / "definitely_not_a_dir"
        # Pre-create as a *file* so .graphcaster/ inside it cannot be made.
        bad_root.write_text("not-a-dir")
        monkeypatch.setenv("GC_WORKSPACE_ROOT", str(bad_root))
        _reset_state()
        key = _load_hmac_key()

    assert key is None
    assert any(_HMAC_DISABLED_WARNING in rec.getMessage() for rec in caplog.records)


# ---------------------------------------------------------------------------
# Emit & verify with HMAC enabled
# ---------------------------------------------------------------------------


def test_emit_with_hmac_writes_hmac_and_mac_version(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    log = _setup_env(tmp_path, monkeypatch)
    emit(action="graph.create", actor="alice", target_kind="graph", target_id="g1")

    raw = log.read_text(encoding="utf-8").strip().splitlines()
    assert len(raw) == 1
    d = json.loads(raw[0])
    assert d["mac_version"] == 2
    assert d["hmac"]
    # hex-encoded SHA-256 -> 64 chars
    assert len(d["hmac"]) == 64
    assert all(c in "0123456789abcdef" for c in d["hmac"])


def test_verify_chain_with_hmac_succeeds(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    log = _setup_env(tmp_path, monkeypatch)
    for i in range(5):
        emit(action="graph.create", actor="alice", target_kind="graph", target_id=f"g{i}")

    ok, checked, bad_id = verify_chain(log)
    assert ok is True
    assert checked == 5
    assert bad_id is None


def test_verify_chain_detects_hmac_tamper(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    log = _setup_env(tmp_path, monkeypatch)
    for i in range(3):
        emit(action="graph.create", actor="alice", target_kind="graph", target_id=f"g{i}")

    # Tamper with line 1's HMAC only (leave entry_hash & payload intact — this
    # is a stronger test: only the HMAC differs, the chain still appears valid.)
    lines = log.read_text(encoding="utf-8").splitlines()
    d = json.loads(lines[1])
    d["hmac"] = "0" * 64
    lines[1] = json.dumps(d, separators=(",", ":"))
    log.write_text("\n".join(lines) + "\n", encoding="utf-8")

    ok, _, bad_id = verify_chain(log)
    assert ok is False
    assert bad_id == d["id"]


def test_verify_chain_detects_payload_tamper(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Mutating the payload should still be caught via entry_hash mismatch."""
    log = _setup_env(tmp_path, monkeypatch)
    for i in range(3):
        emit(action="graph.create", actor="alice", target_kind="graph", target_id=f"g{i}")

    lines = log.read_text(encoding="utf-8").splitlines()
    d = json.loads(lines[1])
    d["actor"] = "mallory"
    lines[1] = json.dumps(d, separators=(",", ":"))
    log.write_text("\n".join(lines) + "\n", encoding="utf-8")

    ok, _, bad_id = verify_chain(log)
    assert ok is False
    assert bad_id == d["id"]


# ---------------------------------------------------------------------------
# Backwards compatibility — pre-HMAC entries
# ---------------------------------------------------------------------------


def _write_legacy_entry(
    log: Path, *, prev_hash: str, action: str, actor: str, target_id: str
) -> dict:
    """Hand-craft an entry without hmac/mac_version (simulates pre-v2 format)."""
    import uuid
    from datetime import datetime, timezone

    d = {
        "id": str(uuid.uuid4()),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "actor": actor,
        "actor_kind": "user",
        "tenant_id": "default",
        "action": action,
        "target_kind": "graph",
        "target_id": target_id,
        "result": "success",
        "metadata": {},
        "ip": None,
        "user_agent": None,
        "prev_hash": prev_hash,
        "entry_hash": "",
    }
    d["entry_hash"] = _compute_entry_hash(d)
    log.parent.mkdir(parents=True, exist_ok=True)
    with log.open("a", encoding="utf-8") as f:
        f.write(json.dumps(d, separators=(",", ":")) + "\n")
    return d


def test_verify_chain_accepts_legacy_entries(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    log = _setup_env(tmp_path, monkeypatch)
    prev = ""
    for i in range(3):
        d = _write_legacy_entry(
            log, prev_hash=prev, action="graph.create", actor="alice", target_id=f"g{i}"
        )
        prev = d["entry_hash"]

    ok, checked, bad_id = verify_chain(log)
    assert ok is True, f"legacy chain failed: {bad_id}"
    assert checked == 3


def test_verify_chain_mixed_legacy_and_v2(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Legacy entries first, then v2 entries appended — both verify together."""
    log = _setup_env(tmp_path, monkeypatch)

    # Write two legacy entries.
    prev = ""
    for i in range(2):
        d = _write_legacy_entry(
            log, prev_hash=prev, action="graph.create", actor="alice", target_id=f"old-{i}"
        )
        prev = d["entry_hash"]

    # Now emit normally. The module-local _last_hash starts at "" but the file
    # already has chained entries — we need to seed it.
    from graph_caster.audit import audit_event as ae

    ae._last_hash = prev  # type: ignore[attr-defined]
    emit(action="graph.update", actor="bob", target_kind="graph", target_id="new-0")
    emit(action="graph.update", actor="bob", target_kind="graph", target_id="new-1")

    ok, checked, bad_id = verify_chain(log)
    assert ok is True, f"mixed chain failed at {bad_id}"
    assert checked == 4


# ---------------------------------------------------------------------------
# Module reset preserves env-key behavior
# ---------------------------------------------------------------------------


def test_reset_state_re_reads_env(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _setup_env(tmp_path, monkeypatch, with_workspace=False)
    monkeypatch.setenv("GC_AUDIT_HMAC_KEY", "aa" * 32)
    _reset_state()
    k1 = _load_hmac_key()
    assert k1 == bytes.fromhex("aa" * 32)

    monkeypatch.setenv("GC_AUDIT_HMAC_KEY", "bb" * 32)
    _reset_state()
    k2 = _load_hmac_key()
    assert k2 == bytes.fromhex("bb" * 32)
