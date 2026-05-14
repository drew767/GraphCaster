# Copyright GraphCaster. All Rights Reserved.

"""Tests for verify-failure rate limiter and scrypt parameter harmonization."""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path

import pytest

from graph_caster.auth.api_keys import (
    ApiKeyStore,
    RateLimited,
    _SCRYPT_LEGACY_N,
    _SCRYPT_N,
    _VerifyRateLimiter,
    _hash_raw_key,
    _parse_stored_hash,
    _verify_raw_key,
)


class _FakeClock:
    def __init__(self, t: float = 0.0) -> None:
        self.t = float(t)

    def __call__(self) -> float:
        return self.t

    def advance(self, dt: float) -> None:
        self.t += float(dt)


@pytest.mark.anyio
async def test_eleventh_failed_verify_is_rate_limited(tmp_path: Path) -> None:
    clock = _FakeClock()
    limiter = _VerifyRateLimiter(
        max_failures=10,
        window_sec=60.0,
        initial_lockout_sec=60.0,
        max_lockout_sec=300.0,
        clock=clock,
    )
    store = ApiKeyStore(tmp_path, rate_limiter=limiter)
    await store.create("u1", "t1", "Real Key", ["run:view"])
    for _ in range(10):
        assert await store.verify("gc_bad-key", source="1.2.3.4") is None
    with pytest.raises(RateLimited) as exc:
        await store.verify("gc_bad-key", source="1.2.3.4")
    assert exc.value.source == "1.2.3.4"
    assert exc.value.retry_after_sec > 0


@pytest.mark.anyio
async def test_successful_verify_resets_failure_counter(tmp_path: Path) -> None:
    clock = _FakeClock()
    limiter = _VerifyRateLimiter(clock=clock)
    store = ApiKeyStore(tmp_path, rate_limiter=limiter)
    _rec, raw = await store.create("u1", "t1", "Real Key", ["run:view"])
    for _ in range(9):
        assert await store.verify("gc_bad-key", source="src-a") is None
    # Successful verify must clear the per-source counter.
    found = await store.verify(raw, source="src-a")
    assert found is not None
    # 10 more failures from the same source should not lock out yet
    # (counter was reset; threshold is 10).
    for _ in range(9):
        assert await store.verify("gc_bad-key", source="src-a") is None
    # No exception yet — counter started over.
    assert await store.verify("gc_bad-key", source="src-a") is None
    # 11th failure since reset trips the lockout.
    with pytest.raises(RateLimited):
        await store.verify("gc_bad-key", source="src-a")


@pytest.mark.anyio
async def test_rate_limit_isolated_per_source(tmp_path: Path) -> None:
    clock = _FakeClock()
    limiter = _VerifyRateLimiter(clock=clock)
    store = ApiKeyStore(tmp_path, rate_limiter=limiter)
    await store.create("u1", "t1", "Real Key", ["run:view"])
    for _ in range(10):
        assert await store.verify("gc_bad", source="src-a") is None
    with pytest.raises(RateLimited):
        await store.verify("gc_bad", source="src-a")
    # Different source still works.
    assert await store.verify("gc_bad", source="src-b") is None


@pytest.mark.anyio
async def test_lockout_expires_after_retry_after(tmp_path: Path) -> None:
    clock = _FakeClock()
    limiter = _VerifyRateLimiter(
        max_failures=3,
        window_sec=60.0,
        initial_lockout_sec=30.0,
        max_lockout_sec=300.0,
        clock=clock,
    )
    store = ApiKeyStore(tmp_path, rate_limiter=limiter)
    await store.create("u1", "t1", "Real Key", ["run:view"])
    for _ in range(3):
        assert await store.verify("gc_bad", source="src") is None
    with pytest.raises(RateLimited):
        await store.verify("gc_bad", source="src")
    # Advance past the lockout window; source should be allowed again.
    clock.advance(31.0)
    assert await store.verify("gc_bad", source="src") is None


@pytest.mark.anyio
async def test_default_source_is_global_when_unspecified(tmp_path: Path) -> None:
    clock = _FakeClock()
    limiter = _VerifyRateLimiter(clock=clock)
    store = ApiKeyStore(tmp_path, rate_limiter=limiter)
    await store.create("u1", "t1", "Real Key", ["run:view"])
    for _ in range(10):
        assert await store.verify("gc_bad") is None
    with pytest.raises(RateLimited):
        await store.verify("gc_bad")


def test_new_hash_format_includes_scrypt_params() -> None:
    h = _hash_raw_key("hunter2")
    assert h.startswith("scrypt$n=")
    assert "$n=16384$" in h
    assert h.count("$") == 5


def test_parse_stored_hash_handles_new_format() -> None:
    h = _hash_raw_key("hello")
    parsed = _parse_stored_hash(h)
    assert parsed is not None
    n, r, p, salt, dk = parsed
    assert (n, r, p) == (_SCRYPT_N, 8, 1)
    assert len(salt) == 16
    assert len(dk) == 64


def test_parse_stored_hash_handles_legacy_format() -> None:
    salt = b"\x00" * 16
    dk = hashlib.scrypt(b"legacy", salt=salt, n=_SCRYPT_LEGACY_N, r=8, p=1)
    legacy = salt.hex() + ":" + dk.hex()
    parsed = _parse_stored_hash(legacy)
    assert parsed is not None
    n, r, p, parsed_salt, parsed_dk = parsed
    assert (n, r, p) == (_SCRYPT_LEGACY_N, 8, 1)
    assert parsed_salt == salt
    assert parsed_dk == dk


def test_verify_against_legacy_hash_still_works_and_flags_rehash() -> None:
    salt = b"\x11" * 16
    dk = hashlib.scrypt(b"sekret", salt=salt, n=_SCRYPT_LEGACY_N, r=8, p=1)
    legacy = salt.hex() + ":" + dk.hex()
    ok, needs_rehash = _verify_raw_key("sekret", legacy)
    assert ok is True
    assert needs_rehash is True
    bad, _ = _verify_raw_key("wrong", legacy)
    assert bad is False


def test_verify_against_new_hash_does_not_request_rehash() -> None:
    h = _hash_raw_key("fresh")
    ok, needs_rehash = _verify_raw_key("fresh", h)
    assert ok is True
    assert needs_rehash is False


@pytest.mark.anyio
async def test_verify_opportunistically_rehashes_legacy_record(tmp_path: Path) -> None:
    """Pre-existing on-disk records with the legacy hash format should
    successfully verify and be transparently rehashed to the new format."""
    tenant_dir = tmp_path / ".graphcaster" / "api-keys" / "t1"
    tenant_dir.mkdir(parents=True)
    raw_key = "gc_legacy-secret"
    salt = b"\x22" * 16
    dk = hashlib.scrypt(raw_key.encode("utf-8"), salt=salt, n=_SCRYPT_LEGACY_N, r=8, p=1)
    legacy_hash = salt.hex() + ":" + dk.hex()
    record_path = tenant_dir / "gc_legacy0000000001.json"
    record_path.write_text(
        json.dumps(
            {
                "id": "gc_legacy0000000001",
                "user_id": "u1",
                "tenant_id": "t1",
                "label": "Legacy",
                "key_hash": legacy_hash,
                "scopes": ["run:view"],
                "created_at": "2026-01-01T00:00:00+00:00",
                "last_used_at": None,
            }
        ),
        encoding="utf-8",
    )

    store = ApiKeyStore(tmp_path)
    found = await store.verify(raw_key, source="src")
    assert found is not None
    assert found.id == "gc_legacy0000000001"

    # On disk the hash should now use the new prefixed format.
    persisted = json.loads(record_path.read_text(encoding="utf-8"))
    assert persisted["key_hash"].startswith("scrypt$n=")
    # And re-verifying still works with the rehashed value.
    again = await store.verify(raw_key, source="src")
    assert again is not None
