# Copyright Aura. All Rights Reserved.

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from graph_caster.models import GraphDocument
from graph_caster.runner import GraphRunner


def main() -> None:
    parser = argparse.ArgumentParser(prog="graph-caster", description="GraphCaster Python runner (stub CLI)")
    parser.add_argument("--document", "-d", type=Path, help="Path to graph JSON document")
    parser.add_argument("--start", "-s", default="", help="Start node id (optional)")
    args = parser.parse_args()

    if not args.document:
        parser.print_help()
        sys.exit(0)

    raw = json.loads(args.document.read_text(encoding="utf-8"))
    doc = GraphDocument.from_dict(raw)

    def sink(ev: dict) -> None:
        print(json.dumps(ev, ensure_ascii=False), flush=True)

    runner = GraphRunner(doc, sink=sink)
    start = args.start or (doc.nodes[0].id if doc.nodes else "")
    if not start:
        print("no nodes in document", file=sys.stderr)
        sys.exit(1)
    runner.run_from(start, context={"last_result": True})


if __name__ == "__main__":
    main()
