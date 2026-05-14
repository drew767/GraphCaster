# Copyright GraphCaster. All Rights Reserved.

"""Built-in tool: simple read-only HTTP GET."""

from __future__ import annotations

from typing import Any


async def http_get(
    url: str,
    *,
    headers: dict | None = None,
    timeout_sec: float = 30.0,
    _transport: Any = None,
) -> dict:
    """Perform a read-only HTTP GET request.

    Returns {status: int, body: str}.
    Simpler than F98 api_call — no auth, no retry, no secret expansion.
    """
    import httpx

    if not url:
        raise ValueError("url must not be empty")

    hdrs: dict[str, str] = {}
    if headers:
        hdrs.update({str(k): str(v) for k, v in headers.items()})

    client_kwargs: dict = {
        "timeout": float(timeout_sec),
        "follow_redirects": True,
    }
    if _transport is not None:
        client_kwargs["transport"] = _transport

    async with httpx.AsyncClient(**client_kwargs) as client:
        resp = await client.get(url, headers=hdrs)

    try:
        body = resp.text
    except Exception:
        body = resp.content.decode("utf-8", errors="replace")

    return {"status": resp.status_code, "body": body}
