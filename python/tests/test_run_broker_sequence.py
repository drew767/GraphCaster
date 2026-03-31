# Copyright GraphCaster. All Rights Reserved.

"""Tests for sequence generator."""

from __future__ import annotations

import threading

from graph_caster.run_broker.sequence_generator import SequenceGenerator


def test_sequence_generator_monotonic() -> None:
    """Sequences must be strictly monotonic across all events."""
    gen = SequenceGenerator()
    seqs = [gen.next_seq() for _ in range(100)]
    assert seqs == list(range(1, 101))


def test_sequence_generator_thread_safe() -> None:
    """Sequence generator must be thread-safe."""
    gen = SequenceGenerator()
    results: list[int] = []

    def grab_seqs() -> None:
        for _ in range(100):
            results.append(gen.next_seq())

    threads = [threading.Thread(target=grab_seqs) for _ in range(5)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert len(results) == 500
    assert len(set(results)) == 500
    assert max(results) == 500
