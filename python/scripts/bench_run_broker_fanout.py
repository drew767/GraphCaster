# Copyright Aura. All Rights Reserved.
"""Manual benchmark: RunBroadcaster fan-out throughput (not run by pytest).

Example:
  py -3 scripts/bench_run_broker_fanout.py --messages 5000 --subscribers 10
  py -3 scripts/bench_run_broker_fanout.py --messages 2000 --latency-samples 500 --rss

Interprets the printed ``lines/sec`` as a coarse baseline on the current machine.
Optional **--latency-samples** records per-message broadcast→first-subscriber latency (nanoseconds)
and prints p50/p90/p99. **--rss** prints process RSS (MiB) before/after when **psutil** is installed.
"""

from __future__ import annotations

import argparse
import json
import time

from graph_caster.run_broker.broadcaster import FanOutMsg, RunBroadcaster, RunBroadcasterConfig


def _percentile_ns(samples: list[int], p: float) -> float:
    if not samples:
        return float("nan")
    s = sorted(samples)
    if len(s) == 1:
        return float(s[0])
    k = (len(s) - 1) * (p / 100.0)
    lo = int(k)
    hi = min(lo + 1, len(s) - 1)
    if lo == hi:
        return float(s[lo])
    frac = k - lo
    return float(s[lo] * (1.0 - frac) + s[hi] * frac)


def _rss_mib() -> float | None:
    try:
        import psutil
    except ImportError:
        return None
    return psutil.Process().memory_info().rss / (1024 * 1024)


def main() -> None:
    p = argparse.ArgumentParser(description="Bench RunBroadcaster stdout fan-out.")
    p.add_argument("--messages", type=int, default=2000)
    p.add_argument("--subscribers", type=int, default=5)
    p.add_argument("--queue-depth", type=int, default=8192)
    p.add_argument(
        "--latency-samples",
        type=int,
        default=0,
        metavar="N",
        help="Measure N broadcast→subscriber latencies (ns); 0 to skip.",
    )
    p.add_argument("--rss", action="store_true", help="Print RSS (MiB) if psutil is installed.")
    args = p.parse_args()

    rss_before = _rss_mib() if args.rss else None
    if args.rss and rss_before is None:
        print("rss_mib_before=n/a (install psutil for RSS)")

    run_id = "bench-run"
    bc = RunBroadcaster(
        run_id=run_id,
        config=RunBroadcasterConfig(max_sub_queue_depth=max(64, args.queue_depth)),
    )
    qs = [bc.subscribe() for _ in range(args.subscribers)]

    line = json.dumps({"type": "process_output", "data": "x"}, separators=(",", ":"))

    latencies: list[int] = []
    n_lat = min(max(0, args.latency_samples), args.messages)
    if n_lat > 0:
        q0 = qs[0]
        for _ in range(n_lat):
            t0 = time.perf_counter_ns()
            bc.broadcast(FanOutMsg("out", line))
            m = q0.get()
            assert m.kind == "out"
            latencies.append(time.perf_counter_ns() - t0)

    t0 = time.perf_counter()
    for _ in range(n_lat, args.messages):
        bc.broadcast(FanOutMsg("out", line))
    for qi, qo in enumerate(qs):
        n_drain = args.messages if qi > 0 else max(0, args.messages - n_lat)
        for _ in range(n_drain):
            m = qo.get()
            assert m.kind == "out"
    sec = time.perf_counter() - t0
    n_bulk = max(0, args.messages - n_lat)
    rate = n_bulk / sec if sec > 0 and n_bulk > 0 else 0.0
    print(
        f"messages={args.messages} subscribers={args.subscribers} time_sec={sec:.3f} lines_per_sec={rate:.0f}",
    )

    if latencies:
        print(
            "latency_ns "
            f"p50={_percentile_ns(latencies, 50):.0f} p90={_percentile_ns(latencies, 90):.0f} "
            f"p99={_percentile_ns(latencies, 99):.0f} samples={len(latencies)}",
        )

    if args.rss:
        rss_after = _rss_mib()
        if rss_before is not None and rss_after is not None:
            print(f"rss_mib_before={rss_before:.1f} rss_mib_after={rss_after:.1f}")
        elif rss_after is not None:
            print(f"rss_mib_after={rss_after:.1f}")


if __name__ == "__main__":
    main()
