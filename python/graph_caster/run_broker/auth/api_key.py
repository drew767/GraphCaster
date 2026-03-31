# Copyright Aura. All Rights Reserved.

from __future__ import annotations

import hashlib
import hmac
import secrets
from dataclasses import dataclass
from typing import Optional


@dataclass
class APIKey:
    """API key with associated metadata."""

    key_id: str
    key_hash: str
    name: str
    scopes: list[str]
    enabled: bool = True


class APIKeyAuthenticator:
    """Simple API key authentication for REST API.

    Keys are validated via constant-time comparison of SHA256 hash.
    """

    def __init__(self) -> None:
        self._keys: dict[str, APIKey] = {}

    def register_key(
        self, key_id: str, secret: str, name: str, scopes: list[str]
    ) -> None:
        """Register an API key."""
        key_hash = hashlib.sha256(secret.encode()).hexdigest()
        self._keys[key_id] = APIKey(
            key_id=key_id,
            key_hash=key_hash,
            name=name,
            scopes=scopes,
        )

    def validate(self, auth_header: str | None) -> Optional[APIKey]:
        """Validate an Authorization header.

        Expects: "Bearer <key_id>:<secret>"
        Returns APIKey if valid, None otherwise.
        """
        if not auth_header or not auth_header.startswith("Bearer "):
            return None
        token = auth_header[7:]
        if ":" not in token:
            return None
        key_id, secret = token.split(":", 1)
        key = self._keys.get(key_id)
        if not key or not key.enabled:
            return None
        secret_hash = hashlib.sha256(secret.encode()).hexdigest()
        if not hmac.compare_digest(secret_hash, key.key_hash):
            return None
        return key

    def has_scope(self, key: APIKey, scope: str) -> bool:
        """Check if key has required scope."""
        return "*" in key.scopes or scope in key.scopes

    def disable_key(self, key_id: str) -> bool:
        """Disable an API key. Returns True if key existed."""
        key = self._keys.get(key_id)
        if key is None:
            return False
        key.enabled = False
        return True

    def enable_key(self, key_id: str) -> bool:
        """Enable a disabled API key. Returns True if key existed."""
        key = self._keys.get(key_id)
        if key is None:
            return False
        key.enabled = True
        return True

    @staticmethod
    def generate_key() -> tuple[str, str]:
        """Generate a new key_id and secret."""
        key_id = f"gc_{secrets.token_hex(8)}"
        secret = secrets.token_urlsafe(32)
        return key_id, secret
