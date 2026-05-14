# Copyright GraphCaster. All Rights Reserved.

"""Unit tests for :class:`graph_caster.runner.secrets_resolver.WorkspaceSecretsResolver`.

Exercises the lazy load and per-node fingerprint gating without spinning up a
:class:`GraphRunner`.
"""

from __future__ import annotations

from typing import Any

from graph_caster.runner.secrets_resolver import WorkspaceSecretsResolver


class _FakeProvider:
    def __init__(self, mapping: dict[str, str], fp: str) -> None:
        self._mapping = mapping
        self._fp = fp
        self.mapping_calls = 0
        self.fingerprint_calls = 0

    def as_mapping(self) -> dict[str, str]:
        self.mapping_calls += 1
        return self._mapping

    def fingerprint(self) -> str:
        self.fingerprint_calls += 1
        return self._fp


def _patch_factory(monkeypatch, fake: _FakeProvider) -> list[Any]:
    """Replace make_secrets_provider with one that records calls; returns the call log."""
    calls: list[Any] = []

    def _factory(root: Any) -> _FakeProvider:
        calls.append(root)
        return fake

    monkeypatch.setattr("graph_caster.secrets.factory.make_secrets_provider", _factory)
    return calls


def test_resolver_lazily_constructs_provider(monkeypatch) -> None:
    fake = _FakeProvider({"K": "v"}, "fp-abc")
    factory_calls = _patch_factory(monkeypatch, fake)
    resolver = WorkspaceSecretsResolver(workspace_root_provider=lambda: "/ws")
    # construction does not invoke factory
    assert factory_calls == []
    # first call materialises the provider with the resolved root
    resolver.ensure_provider()
    assert factory_calls == ["/ws"]
    # subsequent calls reuse the cached instance
    resolver.ensure_provider()
    assert factory_calls == ["/ws"]


def test_mapping_is_cached(monkeypatch) -> None:
    fake = _FakeProvider({"A": "1", "B": "2"}, "fp1")
    _patch_factory(monkeypatch, fake)
    resolver = WorkspaceSecretsResolver(workspace_root_provider=lambda: "/ws")
    m1 = resolver.get_mapping()
    m2 = resolver.get_mapping()
    assert m1 == {"A": "1", "B": "2"}
    assert m2 is m1 or m2 == m1
    assert fake.mapping_calls == 1


def test_fingerprint_is_cached(monkeypatch) -> None:
    fake = _FakeProvider({}, "fp-zzz")
    _patch_factory(monkeypatch, fake)
    resolver = WorkspaceSecretsResolver(workspace_root_provider=lambda: "/ws")
    assert resolver.get_fingerprint() == "fp-zzz"
    assert resolver.get_fingerprint() == "fp-zzz"
    assert fake.fingerprint_calls == 1


def test_step_cache_fingerprint_returns_none_when_node_has_no_env_keys(monkeypatch) -> None:
    fake = _FakeProvider({}, "fp-xyz")
    _patch_factory(monkeypatch, fake)
    resolver = WorkspaceSecretsResolver(workspace_root_provider=lambda: "/ws")
    # node has no envKeys → no fingerprint contribution
    assert resolver.step_cache_fingerprint_for_node({"command": "echo hi"}) is None
    # provider was not even consulted
    assert fake.fingerprint_calls == 0


def test_step_cache_fingerprint_returns_fp_when_node_declares_env_keys(monkeypatch) -> None:
    fake = _FakeProvider({"FOO": "bar"}, "fp-need")
    _patch_factory(monkeypatch, fake)
    resolver = WorkspaceSecretsResolver(workspace_root_provider=lambda: "/ws")
    fp = resolver.step_cache_fingerprint_for_node({"command": "echo", "envKeys": ["FOO"]})
    assert fp == "fp-need"
