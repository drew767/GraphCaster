# Copyright GraphCaster. All Rights Reserved.

"""Built-in tool: UUID generation."""

from __future__ import annotations

import uuid as _uuid


_NAMESPACE_DNS = _uuid.NAMESPACE_DNS


async def uuid_new(*, version: int = 4, name: str = "", namespace: str = "dns") -> str:
    """Generate a new UUID string.

    version: 1, 3, 4, or 5 (default 4).
    name:    Required for version 3 (MD5) and 5 (SHA-1) UUIDs.
    namespace: Namespace for v3/v5: "dns", "url", "oid", "x500". Default "dns".
    """
    v = int(version)

    if v == 1:
        return str(_uuid.uuid1())

    if v == 4:
        return str(_uuid.uuid4())

    _NS_MAP = {
        "dns": _uuid.NAMESPACE_DNS,
        "url": _uuid.NAMESPACE_URL,
        "oid": _uuid.NAMESPACE_OID,
        "x500": _uuid.NAMESPACE_X500,
    }
    ns = _NS_MAP.get(str(namespace).lower(), _uuid.NAMESPACE_DNS)

    if v == 3:
        return str(_uuid.uuid3(ns, name))

    if v == 5:
        return str(_uuid.uuid5(ns, name))

    raise ValueError(f"Unsupported UUID version: {version}. Use 1, 3, 4, or 5.")
