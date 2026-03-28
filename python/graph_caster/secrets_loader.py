# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import hashlib
from pathlib import Path

SECRETS_REL_PATH = Path(".graphcaster") / "workspace.secrets.env"


def secrets_file_fingerprint(workspace_root: Path | None) -> str:
    if workspace_root is None:
        return "no_workspace"
    path = (Path(workspace_root).resolve() / SECRETS_REL_PATH).resolve()
    if not path.is_file():
        return "no_file"
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_workspace_secrets(workspace_root: Path | None) -> dict[str, str]:
    if workspace_root is None:
        return {}
    path = (Path(workspace_root).resolve() / SECRETS_REL_PATH).resolve()
    if not path.is_file():
        return {}
    return parse_dotenv_lines(path.read_text(encoding="utf-8"))


def parse_dotenv_lines(text: str) -> dict[str, str]:
    """Parse KEY=value lines; later duplicate keys overwrite earlier ones."""
    out: dict[str, str] = {}
    for line in text.splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        if "=" not in s:
            continue
        key, _, rest = s.partition("=")
        k = key.strip()
        if not k or k.startswith("#"):
            continue
        val = rest.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        out[k] = val
    return out
