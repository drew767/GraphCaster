# Copyright Aura. All Rights Reserved.

from __future__ import annotations

import hashlib
import struct
from typing import Sequence


def hash_embedding(text: str, dims: int = 64) -> list[float]:
    """Deterministic pseudo-embedding for tests and offline/dev (no model dependency)."""
    if dims < 8 or dims > 4096:
        raise ValueError("dims must be between 8 and 4096")
    seed = hashlib.sha256(text.encode("utf-8")).digest()
    out: list[float] = []
    buf = seed
    off = 0
    while len(out) < dims:
        if off + 4 > len(buf):
            buf = hashlib.sha256(buf).digest()
            off = 0
        u = struct.unpack(">I", buf[off : off + 4])[0]
        out.append((u / 0xFFFFFFFF) * 2.0 - 1.0)
        off += 4
    return out


def cosine_similarity(a: Sequence[float], b: Sequence[float]) -> float:
    if len(a) != len(b):
        return 0.0
    dot = 0.0
    na = 0.0
    nb = 0.0
    for x, y in zip(a, b, strict=True):
        dot += x * y
        na += x * x
        nb += y * y
    if na <= 0.0 or nb <= 0.0:
        return 0.0
    return dot / (na**0.5 * nb**0.5)
