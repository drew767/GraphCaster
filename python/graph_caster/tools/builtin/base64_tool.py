# Copyright GraphCaster. All Rights Reserved.

"""Built-in tool: Base64 encode/decode."""

from __future__ import annotations

import base64 as _b64
from typing import Union


async def b64_encode(data: Union[str, bytes]) -> str:
    """Encode a string or bytes as Base64.

    If *data* is a str it is UTF-8 encoded first.
    Returns the Base64-encoded ASCII string.
    """
    if isinstance(data, str):
        raw = data.encode("utf-8")
    else:
        raw = bytes(data)
    return _b64.b64encode(raw).decode("ascii")


async def b64_decode(s: str) -> bytes:
    """Decode a Base64 string back to bytes.

    Accepts standard and URL-safe Base64 (with optional padding).
    """
    padded = s.strip()
    missing = len(padded) % 4
    if missing:
        padded += "=" * (4 - missing)
    return _b64.b64decode(padded)
