# Copyright Aura. All Rights Reserved.

from __future__ import annotations


def split_text_chunks(text: str, *, chunk_size: int, overlap: int) -> list[str]:
    """Character-window splitter (simple, no external deps)."""
    t = text.strip()
    if not t:
        return []
    size = max(32, min(32_000, chunk_size))
    ov = max(0, min(size - 1, overlap))
    out: list[str] = []
    i = 0
    while i < len(t):
        chunk = t[i : i + size]
        if chunk.strip():
            out.append(chunk)
        if i + size >= len(t):
            break
        i += max(1, size - ov)
    return out
