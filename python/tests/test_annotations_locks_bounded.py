# Copyright GraphCaster. All Rights Reserved.

"""Memory-bound test for the per-path annotation locks (P1)."""

from __future__ import annotations

import asyncio
import gc

import pytest


pytestmark = pytest.mark.anyio


async def test_locks_self_evict_when_no_callers_hold_ref() -> None:
    """Insert many distinct keys; once no caller holds the lock the entry drops out of the map."""
    from graph_caster import annotations as ann_mod

    # Empty the map and force GC for a clean baseline.
    ann_mod._LOCKS.clear()
    gc.collect()
    assert ann_mod._locks_size() == 0

    async def touch(key: str) -> None:
        lock = await ann_mod._get_lock(key)
        async with lock:
            pass  # critical section instant
        # Local ref to ``lock`` drops here; the weak entry can now die.

    await asyncio.gather(*(touch(f"k-{i}") for i in range(5000)))

    # After all callers released their strong refs and GC ran, the dictionary should not be growing
    # linearly in the number of keys ever inserted.
    size = ann_mod._locks_size()
    assert size < 100, f"Lock cache grew unbounded: {size} entries"


async def test_same_key_reuses_lock_while_caller_holds_ref() -> None:
    """Two callers asking for the same key in flight must get the same lock instance."""
    from graph_caster import annotations as ann_mod

    ann_mod._LOCKS.clear()
    gc.collect()

    l1 = await ann_mod._get_lock("shared")
    l2 = await ann_mod._get_lock("shared")
    assert l1 is l2
