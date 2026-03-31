# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from graph_caster.artifacts_s3 import _upload_run_dir_sync, schedule_run_dir_upload_maybe


def test_schedule_skips_without_bucket(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("GC_RUN_ARTIFACTS_S3_BUCKET", raising=False)
    with patch("graph_caster.artifacts_s3.threading.Thread") as th:
        schedule_run_dir_upload_maybe(tmp_path, graph_id="g1", run_id="r1")
        th.assert_not_called()


def test_schedule_starts_thread_when_bucket_set(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("GC_RUN_ARTIFACTS_S3_BUCKET", "my-bucket")
    mock_thread = MagicMock()
    with patch("graph_caster.artifacts_s3.threading.Thread", return_value=mock_thread) as th_ctor:
        schedule_run_dir_upload_maybe(tmp_path, graph_id="g1", run_id="r1")
    th_ctor.assert_called_once()
    mock_thread.start.assert_called_once()


def test_upload_sync_skips_missing_dir(tmp_path: Path) -> None:
    pytest.importorskip("boto3")
    missing = tmp_path / "nope"
    mock_client = MagicMock()
    with patch("boto3.client", return_value=mock_client):
        _upload_run_dir_sync(
            run_dir=missing,
            graph_id="gid",
            run_id="rid",
            bucket="b",
            prefix="p",
            region=None,
        )
    mock_client.upload_file.assert_not_called()


def test_upload_sync_uploads_files(tmp_path: Path) -> None:
    pytest.importorskip("boto3")
    rd = tmp_path / "run"
    rd.mkdir()
    (rd / "a.txt").write_text("hi", encoding="utf-8")
    sub = rd / "sub"
    sub.mkdir()
    (sub / "b.bin").write_bytes(b"\x01\x02")

    mock_client = MagicMock()
    with patch("boto3.client", return_value=mock_client):
        _upload_run_dir_sync(
            run_dir=rd,
            graph_id="my/gid",
            run_id="my\\rid",
            bucket="buck",
            prefix="pre",
            region="eu-west-1",
        )

    assert mock_client.upload_file.call_count == 2
    paths = {str(call.args[0]) for call in mock_client.upload_file.call_args_list}
    assert str((rd / "a.txt").resolve()) in paths
    assert str((sub / "b.bin").resolve()) in paths
    keys = {call.args[2] for call in mock_client.upload_file.call_args_list}
    assert "pre/my_gid/my_rid/a.txt" in keys
    assert "pre/my_gid/my_rid/sub/b.bin" in keys
    buck_calls = {call.args[1] for call in mock_client.upload_file.call_args_list}
    assert buck_calls == {"buck"}
