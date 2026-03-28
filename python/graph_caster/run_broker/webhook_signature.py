# Copyright GraphCaster. All Rights Reserved.

"""HMAC verification for signed run webhooks (dev broker).

**Header name:** ``X-GC-Webhook-Signature`` (case-insensitive per HTTP).

**Value format:** ``sha256=`` followed by **lowercase hexadecimal** encoding of
``HMAC-SHA256(secret_utf8, raw_request_body)``. The ``sha256=`` prefix is
compared case-insensitively; surrounding ASCII whitespace on the header value
is stripped. The hex digest must be exactly 64 hex characters (compare in
constant time after normalization).

**Secret:** bytes of ``GC_RUN_BROKER_WEBHOOK_SECRET`` interpreted as **UTF-8**.
The caller must reject an empty secret before invoking verification.

**Security:** this module never logs the secret or the derived MAC.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets


def verify_webhook_signature(body: bytes, header: str | None, secret: str) -> bool:
    """Return True if ``header`` matches HMAC-SHA256(body, secret UTF-8)."""
    if not secret or header is None:
        return False
    raw = header.strip()
    if len(raw) < 8:
        return False
    if raw[:7].lower() != "sha256=":
        return False
    sig_hex = raw[7:].strip().replace(" ", "").replace("\t", "")
    if len(sig_hex) != 64:
        return False
    try:
        int(sig_hex, 16)
    except ValueError:
        return False
    expected = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return secrets.compare_digest(expected, sig_hex.lower())
