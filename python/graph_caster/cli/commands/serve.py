"""`serve` command — HTTP+SSE dev broker."""
from __future__ import annotations

import argparse


def register(sub: argparse._SubParsersAction) -> None:
    srv = sub.add_parser(
        "serve",
        help="HTTP+SSE dev broker for web UI (wraps graph_caster run in a subprocess)",
    )
    srv.add_argument("--host", default="127.0.0.1", help="Bind address")
    srv.add_argument("--port", type=int, default=9847, help="Listen port")


def execute(args: argparse.Namespace) -> int:
    import sys

    try:
        import uvicorn
    except ImportError:
        print(
            "graph-caster serve: install broker extras: pip install -e '.[broker]'",
            file=sys.stderr,
        )
        return 2
    from graph_caster.run_broker.app import create_app

    app = create_app()
    uvicorn.run(app, host=str(args.host), port=int(args.port), log_level="warning")
    return 0
