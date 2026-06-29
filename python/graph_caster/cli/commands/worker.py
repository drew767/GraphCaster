"""`worker` command — RQ worker."""
from __future__ import annotations

import argparse


def register(sub: argparse._SubParsersAction) -> None:
    wrk = sub.add_parser(
        "worker",
        help="RQ worker for scaling queue (requires pip install -e '.[scaling]')",
    )
    wrk.add_argument("--redis-url", required=True, help="Redis URL for RQ")
    wrk.add_argument("--queue", default="gc:runs", help="RQ queue name")
    wrk.add_argument(
        "--burst",
        action="store_true",
        help="Exit when the queue becomes empty",
    )


def execute(args: argparse.Namespace) -> int:
    from graph_caster.scaling.worker import main as worker_main

    return worker_main(
        [
            "--redis-url",
            str(args.redis_url),
            "--queue",
            str(args.queue),
            *([] if not args.burst else ["--burst"]),
        ],
    )
