# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from graph_caster.run_catalog import (
    catalog_db_path,
    is_run_catalog_enabled,
    list_run_catalog_rows,
    rebuild_catalog_from_disk,
    upsert_run_from_summary,
)


def test_upsert_list_rebuild_roundtrip(tmp_path: Path) -> None:
    ab = tmp_path / "ws"
    gid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    run_dir = ab / "runs" / gid / "20991231T000000_test01"
    run_dir.mkdir(parents=True)
    summary = {
        "schemaVersion": 1,
        "runId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        "rootGraphId": gid,
        "status": "success",
        "startedAt": "2099-01-01T00:00:00+00:00",
        "finishedAt": "2099-01-01T00:00:01+00:00",
    }
    upsert_run_from_summary(ab, run_dir, summary)
    dbp = catalog_db_path(ab)
    assert dbp.is_file()
    rows = list_run_catalog_rows(ab)
    assert len(rows) == 1
    assert rows[0]["runId"] == summary["runId"]
    assert rows[0]["rootGraphId"] == gid
    assert rows[0]["artifactRelPath"].replace("\\", "/") == f"runs/{gid}/20991231T000000_test01"

    (run_dir / "run-summary.json").write_text(json.dumps(summary), encoding="utf-8")
    n = rebuild_catalog_from_disk(ab)
    assert n == 1
    rows2 = list_run_catalog_rows(ab)
    assert len(rows2) == 1


def test_gc_run_catalog_zero_skips_upsert(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("GC_RUN_CATALOG", "0")
    assert is_run_catalog_enabled() is False
    ab = tmp_path / "ws2"
    gid = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
    run_dir = ab / "runs" / gid / "r1"
    run_dir.mkdir(parents=True)
    upsert_run_from_summary(
        ab,
        run_dir,
        {
            "runId": "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            "rootGraphId": gid,
            "status": "success",
            "finishedAt": "2099-01-01T00:00:00+00:00",
        },
    )
    assert not catalog_db_path(ab).is_file()


def test_rebuild_ignores_invalid_summary(tmp_path: Path) -> None:
    ab = tmp_path / "ws3"
    gid = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
    d = ab / "runs" / gid / "bad"
    d.mkdir(parents=True)
    (d / "run-summary.json").write_text('{"oops":true}', encoding="utf-8")
    n = rebuild_catalog_from_disk(ab)
    assert n == 0


def test_schema_sets_user_version_without_drop(tmp_path: Path) -> None:
    ab = tmp_path / "ws4"
    gid = "ffffffff-ffff-4fff-8fff-ffffffffffff"
    run_dir = ab / "runs" / gid / "r2"
    run_dir.mkdir(parents=True)
    summary = {
        "runId": "11111111-1111-4111-8111-111111111111",
        "rootGraphId": gid,
        "status": "failed",
        "finishedAt": "2099-02-02T00:00:00+00:00",
    }
    upsert_run_from_summary(ab, run_dir, summary)
    dbp = catalog_db_path(ab)
    conn = sqlite3.connect(str(dbp))
    try:
        ver = int(conn.execute("PRAGMA user_version").fetchone()[0])
        assert ver >= 1
        cnt = int(conn.execute("SELECT COUNT(*) FROM runs").fetchone()[0])
        assert cnt == 1
    finally:
        conn.close()
    # Second upsert same run_id updates row, table not dropped
    summary2 = {**summary, "status": "success", "finishedAt": "2099-02-02T00:01:00+00:00"}
    upsert_run_from_summary(ab, run_dir, summary2)
    conn = sqlite3.connect(str(dbp))
    try:
        assert int(conn.execute("SELECT COUNT(*) FROM runs").fetchone()[0]) == 1
        st = conn.execute("SELECT status FROM runs WHERE run_id = ?", (summary["runId"],)).fetchone()[0]
        assert st == "success"
    finally:
        conn.close()


def test_list_filters_graph_and_status(tmp_path: Path) -> None:
    ab = tmp_path / "ws5"
    g1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    g2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    for i, gid in enumerate([g1, g2]):
        run_dir = ab / "runs" / gid / f"run{i}"
        run_dir.mkdir(parents=True)
        upsert_run_from_summary(
            ab,
            run_dir,
            {
                "runId": f"00000000-0000-4000-8000-00000000000{i}",
                "rootGraphId": gid,
                "status": "success" if i == 0 else "failed",
                "finishedAt": f"2099-03-0{i+1}T00:00:00+00:00",
            },
        )
    only_g1 = list_run_catalog_rows(ab, graph_id=g1)
    assert len(only_g1) == 1
    only_fail = list_run_catalog_rows(ab, status="failed")
    assert len(only_fail) == 1
