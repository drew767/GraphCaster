# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import argparse
import sys


def main(argv: list[str] | None = None) -> int:
    try:
        from redis import Redis
        from rq import Worker
    except ImportError:
        print(
            "graph-caster worker: install optional deps: pip install -e '.[scaling]'",
            file=sys.stderr,
        )
        return 2
    p = argparse.ArgumentParser(prog="graph-caster worker")
    p.add_argument("--redis-url", required=True)
    p.add_argument("--queue", default="gc:runs")
    p.add_argument(
        "--burst",
        action="store_true",
        help="Process jobs until the queue is empty, then exit",
    )
    args = p.parse_args(argv)
    conn = Redis.from_url(str(args.redis_url))
    from rq import Queue

    queue = Queue(str(args.queue), connection=conn)
    w = Worker([queue], connection=conn)
    w.work(burst=bool(args.burst))
    return 0
