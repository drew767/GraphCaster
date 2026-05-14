# Copyright GraphCaster. All Rights Reserved.

"""Tests for F87: Audit log enforcement — events, chain hash, query, concurrency."""

from __future__ import annotations

import asyncio
import json
import threading
from pathlib import Path

import pytest

from graph_caster.audit.audit_event import (
    AuditEvent,
    _reset_state,
    emit,
    emit_async,
)
from graph_caster.audit.audit_query import AuditQuery, verify_chain


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _set_log(path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_AUDIT_LOG_PATH", str(path))


def _reset(monkeypatch: pytest.MonkeyPatch) -> None:
    _reset_state()


# ---------------------------------------------------------------------------
# Canonical action emission tests
# ---------------------------------------------------------------------------


CANONICAL_ACTIONS = [
    ("auth.login_success", "user", "user"),
    ("auth.login_failure", "user", "user"),
    ("auth.token_create", "user", "token"),
    ("auth.token_revoke", "user", "token"),
    ("graph.create", "alice", "graph"),
    ("graph.update", "alice", "graph"),
    ("graph.delete", "alice", "graph"),
    ("graph.publish", "alice", "graph"),
    ("graph.rollback", "alice", "graph"),
    ("graph.export", "alice", "graph"),
    ("graph.import", "alice", "graph"),
    ("credential.create", "alice", "credential"),
    ("credential.update", "alice", "credential"),
    ("credential.delete", "alice", "credential"),
    ("credential.use", "alice", "credential"),
    ("run.start", "system", "run"),
    ("run.cancel", "alice", "run"),
    ("dataset.upload", "alice", "dataset"),
    ("dataset.delete", "alice", "dataset"),
    ("annotation.create", "alice", "annotation"),
    ("tool.invoke", "system", "tool"),
    ("plugin.install", "alice", "plugin"),
    ("plugin.uninstall", "alice", "plugin"),
    ("plugin.enable", "alice", "plugin"),
    ("plugin.disable", "alice", "plugin"),
]


@pytest.mark.parametrize("action,actor,target_kind", CANONICAL_ACTIONS)
def test_canonical_action_emitted(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    action: str,
    actor: str,
    target_kind: str,
) -> None:
    log = tmp_path / "audit.jsonl"
    _set_log(log, monkeypatch)
    _reset(monkeypatch)

    emit(
        action=action,
        actor=actor,
        actor_kind="user" if actor not in ("system", "anonymous") else "system",
        target_kind=target_kind,
        target_id="test-id-1",
    )

    assert log.exists(), f"log not created for {action}"
    lines = [l for l in log.read_text(encoding="utf-8").splitlines() if l.strip()]
    assert len(lines) == 1
    d = json.loads(lines[0])
    assert d["action"] == action
    assert d["actor"] == actor
    assert d["target_kind"] == target_kind
    assert d["result"] == "success"
    assert d["entry_hash"]


def test_all_canonical_actions_written(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """All canonical actions can be emitted in one log without error."""
    log = tmp_path / "audit.jsonl"
    _set_log(log, monkeypatch)
    _reset(monkeypatch)

    for action, actor, target_kind in CANONICAL_ACTIONS:
        emit(
            action=action,
            actor=actor,
            actor_kind="user" if actor not in ("system", "anonymous") else "system",
            target_kind=target_kind,
            target_id="x",
        )

    lines = [l for l in log.read_text(encoding="utf-8").splitlines() if l.strip()]
    assert len(lines) == len(CANONICAL_ACTIONS)


# ---------------------------------------------------------------------------
# Chain hash tests
# ---------------------------------------------------------------------------


def test_chain_hash_verify_ok(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    log = tmp_path / "audit.jsonl"
    _set_log(log, monkeypatch)
    _reset(monkeypatch)

    for i in range(5):
        emit(action="graph.create", actor="alice", target_kind="graph", target_id=f"g{i}")

    errors = verify_chain(log)
    assert errors == [], f"Expected no errors, got: {errors}"


def test_chain_hash_tamper_middle(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    log = tmp_path / "audit.jsonl"
    _set_log(log, monkeypatch)
    _reset(monkeypatch)

    for i in range(5):
        emit(action="graph.create", actor="alice", target_kind="graph", target_id=f"g{i}")

    # Tamper with the middle (index 2) entry
    lines = log.read_text(encoding="utf-8").splitlines()
    entry = json.loads(lines[2])
    entry["actor"] = "mallory"  # Mutate actor without updating hashes
    lines[2] = json.dumps(entry, separators=(",", ":"))
    log.write_text("\n".join(lines) + "\n", encoding="utf-8")

    errors = verify_chain(log)
    # Should detect tamper at index 2 or 3 (entry_hash mismatch at 2, prev_hash at 3)
    bad_indices = {e["index"] for e in errors}
    assert bad_indices, "Expected chain verification to detect tampering"
    assert min(bad_indices) <= 3, f"First mismatch too late: {bad_indices}"


def test_chain_hash_prev_hash_linkage(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    log = tmp_path / "audit.jsonl"
    _set_log(log, monkeypatch)
    _reset(monkeypatch)

    emit(action="run.start", actor="system", target_kind="run", target_id="r1")
    emit(action="run.cancel", actor="alice", target_kind="run", target_id="r1")

    lines = [json.loads(l) for l in log.read_text(encoding="utf-8").splitlines() if l.strip()]
    assert lines[0]["prev_hash"] == ""
    assert lines[1]["prev_hash"] == lines[0]["entry_hash"]


def test_chain_hash_empty_log(tmp_path: Path) -> None:
    log = tmp_path / "nonexistent.jsonl"
    errors = verify_chain(log)
    assert errors == []


# ---------------------------------------------------------------------------
# Query filter tests
# ---------------------------------------------------------------------------


@pytest.fixture()
def populated_log(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    log = tmp_path / "audit.jsonl"
    _set_log(log, monkeypatch)
    _reset(monkeypatch)

    actors = ["alice", "bob", "system"]
    actions = ["graph.create", "graph.publish", "run.start"]
    for i, (actor, action) in enumerate(zip(actors * 3, actions * 3)):
        emit(
            action=action,
            actor=actor,
            actor_kind="user" if actor != "system" else "system",
            target_kind=action.split(".")[0],
            target_id=f"id-{i}",
        )
    return log


def test_query_by_actor(populated_log: Path) -> None:
    aq = AuditQuery(populated_log)
    events, cursor = asyncio.run(aq.query(actor="alice"))
    assert all(e.actor == "alice" for e in events)
    assert len(events) >= 1


def test_query_by_action(populated_log: Path) -> None:
    aq = AuditQuery(populated_log)
    events, cursor = asyncio.run(aq.query(action="graph.publish"))
    assert all(e.action == "graph.publish" for e in events)
    assert len(events) >= 1


def test_query_time_range(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    log = tmp_path / "audit.jsonl"
    _set_log(log, monkeypatch)
    _reset(monkeypatch)

    emit(action="graph.create", actor="alice", target_kind="graph", target_id="g1")
    emit(action="graph.update", actor="alice", target_kind="graph", target_id="g2")

    aq = AuditQuery(log)
    events, _ = asyncio.run(aq.query(since="2020-01-01T00:00:00Z"))
    assert len(events) == 2

    events2, _ = asyncio.run(aq.query(until="2020-01-01T00:00:00Z"))
    assert len(events2) == 0


def test_query_pagination(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    log = tmp_path / "audit.jsonl"
    _set_log(log, monkeypatch)
    _reset(monkeypatch)

    for i in range(10):
        emit(action="graph.create", actor="alice", target_kind="graph", target_id=f"g{i}")

    aq = AuditQuery(log)
    page1, cursor = asyncio.run(aq.query(limit=4))
    assert len(page1) == 4
    assert cursor is not None

    page2, cursor2 = asyncio.run(aq.query(limit=4, cursor=cursor))
    assert len(page2) == 4
    assert cursor2 is not None

    page3, cursor3 = asyncio.run(aq.query(limit=4, cursor=cursor2))
    assert len(page3) == 2
    assert cursor3 is None

    # No overlap between pages
    ids1 = {e.id for e in page1}
    ids2 = {e.id for e in page2}
    ids3 = {e.id for e in page3}
    assert ids1.isdisjoint(ids2)
    assert ids2.isdisjoint(ids3)
    assert len(ids1 | ids2 | ids3) == 10


# ---------------------------------------------------------------------------
# Concurrent emission tests
# ---------------------------------------------------------------------------


def test_concurrent_emit_all_preserved(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    log = tmp_path / "audit.jsonl"
    _set_log(log, monkeypatch)
    _reset(monkeypatch)

    errors: list[Exception] = []

    def _worker(actor: str) -> None:
        try:
            emit(action="run.start", actor=actor, target_kind="run", target_id="r1")
        except Exception as exc:
            errors.append(exc)

    threads = [threading.Thread(target=_worker, args=(f"user-{i}",)) for i in range(100)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert errors == [], f"Emit raised exceptions: {errors}"

    lines = [l for l in log.read_text(encoding="utf-8").splitlines() if l.strip()]
    assert len(lines) == 100, f"Expected 100 lines, got {len(lines)}"


def test_concurrent_emit_chain_valid(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    log = tmp_path / "audit.jsonl"
    _set_log(log, monkeypatch)
    _reset(monkeypatch)

    threads = [
        threading.Thread(
            target=emit,
            kwargs={"action": "run.start", "actor": f"user-{i}", "target_kind": "run", "target_id": "r"},
        )
        for i in range(100)
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    errors = verify_chain(log)
    assert errors == [], f"Chain invalid after concurrent emit: {errors[:5]}"


def test_concurrent_async_emit(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    log = tmp_path / "audit.jsonl"
    _set_log(log, monkeypatch)
    _reset(monkeypatch)

    async def _run() -> None:
        await asyncio.gather(
            *[
                emit_async(action="run.start", actor=f"user-{i}", target_kind="run", target_id="r")
                for i in range(100)
            ]
        )

    asyncio.run(_run())

    lines = [l for l in log.read_text(encoding="utf-8").splitlines() if l.strip()]
    assert len(lines) == 100

    errors = verify_chain(log)
    assert errors == [], f"Chain invalid: {errors[:5]}"


# ---------------------------------------------------------------------------
# Emit never raises
# ---------------------------------------------------------------------------


def test_emit_never_raises_on_bad_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GC_AUDIT_LOG_PATH", "/nonexistent-directory/deep/path/audit.jsonl")
    _reset(monkeypatch)
    # Should not raise
    emit(action="graph.create", actor="alice", target_kind="graph", target_id="g1")


def test_emit_no_log_path_no_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GC_AUDIT_LOG_PATH", raising=False)
    _reset(monkeypatch)
    emit(action="graph.create", actor="alice", target_kind="graph", target_id="g1")


# ---------------------------------------------------------------------------
# Prometheus metrics
# ---------------------------------------------------------------------------


def test_prometheus_counters(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from graph_caster.audit.audit_event import prometheus_lines

    log = tmp_path / "audit.jsonl"
    _set_log(log, monkeypatch)
    _reset(monkeypatch)

    emit(action="graph.publish", actor="alice", target_kind="graph", target_id="g1")
    emit(
        action="graph.publish",
        actor="bob",
        target_kind="graph",
        target_id="g2",
        result="failure",
    )

    text = prometheus_lines()
    assert "gc_audit_events_total" in text
    assert 'action="graph.publish"' in text
    assert 'result="success"' in text
    assert 'result="failure"' in text
