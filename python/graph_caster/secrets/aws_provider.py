# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field


@dataclass
class AwsJsonSecretsProvider:
    """AWS Secrets Manager: secret value is a JSON object (flat string map)."""

    secret_id: str
    region: str | None
    _mapping: dict[str, str] = field(default_factory=dict)
    _version_id: str = ""

    @classmethod
    def from_env(cls) -> AwsJsonSecretsProvider:
        try:
            import boto3  # type: ignore[import-untyped]
        except ImportError as e:
            raise ImportError(
                "GC_SECRETS_PROVIDER=aws requires boto3; install graph-caster[s3] or boto3"
            ) from e

        sid = (
            os.environ.get("GC_AWS_SECRET_JSON_ID", "").strip()
            or os.environ.get("GC_AWS_SECRETS_JSON_ID", "").strip()
        )
        if not sid:
            raise ValueError(
                "GC_SECRETS_PROVIDER=aws requires GC_AWS_SECRET_JSON_ID "
                "(Secrets Manager id or ARN)"
            )
        region = os.environ.get("GC_AWS_REGION", "").strip() or None
        kw: dict = {}
        if region:
            kw["region_name"] = region
        client = boto3.client("secretsmanager", **kw)
        r = client.get_secret_value(SecretId=sid)
        vid = str(r.get("VersionId", "") or "")
        raw_s = r.get("SecretString")
        if not raw_s:
            raise ValueError("AWS secret must have SecretString (JSON object)")
        obj = json.loads(raw_s)
        if not isinstance(obj, dict):
            raise ValueError("AWS SecretString must be a JSON object")
        mapping = {str(k): "" if v is None else str(v) for k, v in obj.items()}
        return cls(secret_id=sid, region=region, _mapping=mapping, _version_id=vid)

    def as_mapping(self) -> dict[str, str]:
        return dict(self._mapping)

    def fingerprint(self) -> str:
        r = self.region or ""
        return f"aws:{self.secret_id}:{r}:{self._version_id}"
