# Copyright GraphCaster. All Rights Reserved.

"""Built-in tool: regex extraction."""

from __future__ import annotations

import re
from typing import Union


async def regex_extract(
    text: str,
    pattern: str,
    *,
    group: int = 0,
    all: bool = False,
) -> Union[str, list[str]]:
    """Extract regex matches from text.

    text:    Input string.
    pattern: Regular expression pattern.
    group:   Capture group index (0 = full match). Default 0.
    all:     If True, return all non-overlapping matches as a list.
             If False, return only the first match (or empty string).
    """
    compiled = re.compile(pattern)

    if all:
        matches: list[str] = []
        for m in compiled.finditer(text):
            try:
                matches.append(m.group(group))
            except IndexError:
                matches.append("")
        return matches

    m = compiled.search(text)
    if m is None:
        return ""
    try:
        return m.group(group)
    except IndexError:
        return ""
