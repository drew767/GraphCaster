# Copyright GraphCaster. All Rights Reserved.

"""Built-in tool: current time in various formats."""

from __future__ import annotations

import datetime


async def time_now(*, timezone: str = "UTC", format: str = "iso") -> str:
    """Return the current time as a string.

    timezone: IANA timezone name (e.g. "UTC", "America/New_York"). Requires
              Python 3.9+ zoneinfo or the 'tzdata' package for non-UTC zones.
    format:   "iso" (default) — ISO 8601 with timezone offset
              "unix" — integer Unix epoch as string
              "rfc2822" — RFC 2822 email date format
    """
    try:
        import zoneinfo
        tz = zoneinfo.ZoneInfo(timezone)
    except Exception:
        tz = datetime.timezone.utc

    now = datetime.datetime.now(tz=tz)

    fmt = str(format).lower()
    if fmt == "unix":
        return str(int(now.timestamp()))
    if fmt == "rfc2822":
        return now.strftime("%a, %d %b %Y %H:%M:%S %z")
    return now.isoformat()
