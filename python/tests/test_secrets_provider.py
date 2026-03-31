# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from graph_caster.secrets.factory import make_secrets_provider
from graph_caster.secrets.file_provider import FileSecretsProvider


def test_file_provider_matches_secrets_loader(tmp_path: Path) -> None:
    sec_dir = tmp_path / ".graphcaster"
    sec_dir.mkdir(parents=True)
    (sec_dir / "workspace.secrets.env").write_text("FOO=bar\n", encoding="utf-8")

    p = FileSecretsProvider(tmp_path)
    assert p.as_mapping() == {"FOO": "bar"}
    fp = p.fingerprint()
    assert len(fp) == 64  # sha256 hex

    from graph_caster.secrets_loader import load_workspace_secrets, secrets_file_fingerprint

    assert load_workspace_secrets(tmp_path) == p.as_mapping()
    assert secrets_file_fingerprint(tmp_path) == fp


def test_make_secrets_provider_default_file(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.delenv("GC_SECRETS_PROVIDER", raising=False)
    p = make_secrets_provider(tmp_path)
    assert isinstance(p, FileSecretsProvider)


def test_make_secrets_provider_explicit_file(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("GC_SECRETS_PROVIDER", "file")
    p = make_secrets_provider(tmp_path)
    assert isinstance(p, FileSecretsProvider)


def test_make_secrets_provider_unknown(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("GC_SECRETS_PROVIDER", "bogus")
    with pytest.raises(ValueError, match="Unknown GC_SECRETS_PROVIDER"):
        make_secrets_provider(tmp_path)


def test_vault_provider_from_env_mocked() -> None:
    from graph_caster.secrets.vault_provider import VaultKv2SecretsProvider

    mock_client = MagicMock()
    mock_client.is_authenticated.return_value = True
    mock_client.secrets.kv.v2.read_secret_version.return_value = {
        "data": {
            "metadata": {"version": 7},
            "data": {"API_KEY": "sekret"},
        }
    }
    fake_hvac = MagicMock()
    fake_hvac.Client = MagicMock(return_value=mock_client)

    env = {
        "VAULT_ADDR": "http://127.0.0.1:8200",
        "VAULT_TOKEN": "tok",
        "GC_VAULT_KV_MOUNT": "secret",
        "GC_VAULT_KV_PATH": "graphcaster",
    }
    with patch.dict("os.environ", env, clear=False):
        with patch.dict(sys.modules, {"hvac": fake_hvac}):
            p = VaultKv2SecretsProvider.from_env()
    assert p.as_mapping() == {"API_KEY": "sekret"}
    assert p.fingerprint() == "vault:secret:graphcaster:v7"


def test_aws_provider_from_env_mocked() -> None:
    from graph_caster.secrets.aws_provider import AwsJsonSecretsProvider

    mock_sm = MagicMock()
    mock_sm.get_secret_value.return_value = {
        "SecretString": json.dumps({"K": "v"}),
        "VersionId": "ver-1",
    }
    fake_boto3 = MagicMock()
    fake_boto3.client = MagicMock(return_value=mock_sm)
    env = {"GC_AWS_SECRET_JSON_ID": "arn:aws:secretsmanager:us-east-1:1:secret:x"}
    with patch.dict("os.environ", env, clear=False):
        with patch.dict(sys.modules, {"boto3": fake_boto3}):
            p = AwsJsonSecretsProvider.from_env()
    assert p.as_mapping() == {"K": "v"}
    assert "aws:" in p.fingerprint() and "ver-1" in p.fingerprint()
