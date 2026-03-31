# Copyright Aura. All Rights Reserved.
"""Manual benchmark: RunBroadcaster fan-out throughput (not run by pytest).

Example:
  py -3 scripts/bench_run_broker_fanout.py --messages 5000 --subscribers 10

Interprets the printed ``lines/sec`` as a coarse baseline on the current machine.
"""

from __future__ import annotations

import argparse
import json
import time

from graph_caster.run_broker.broadcaster import FanOutMsg, RunBroadcaster, RunBroadcasterConfig


def main() -> None:
    p = argparse.ArgumentParser(description="Bench RunBroadcaster stdout fan-out.")
    p.add_argument("--messages", type=int, default=2000)
    p.add_argument("--subscribers", type=int, default=5)
    p.add_argument("--queue-depth", type=int, default=8192)
    args = p.parse_args()

    run_id = "bench-run"
    bc = RunBroadcaster(
        run_id=run_id,
        config=RunBroadcasterConfig(max_sub_queue_depth=max(64, args.queue_depth)),
    )
    qs = [bc.subscribe() for _ in range(args.subscribers)]

    line = json.dumps({"type": "process_output", "data": "x"}, separators=(",", ":"))
    t0 = time.perf_counter()
    for _ in range(args.messages):
        bc.broadcast(FanOutMsg("out", line))
    for qo in qs:
        for _ in range(args.messages):
            m = qo.get()
            assert m.kind == "out"
    sec = time.perf_counter() - t0
    rate = args.messages / sec if sec > 0 else 0.0
    print(f"messages={args.messages} subscribers={args.subscribers} time_sec={sec:.3f} lines_per_sec={rate:.0f}")


if __name__ == "__main__":
    main()
