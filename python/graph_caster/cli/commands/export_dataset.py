"""`export-dataset` command."""
from __future__ import annotations

import argparse
from pathlib import Path


def register(sub: argparse._SubParsersAction) -> None:
    ed = sub.add_parser(
        "export-dataset",
        help="Export annotations as a fine-tuning dataset",
    )
    ed.add_argument("--workspace", type=Path, default=Path("."), help="Workspace root (parent of runs/)")
    ed.add_argument("--graph", required=True, dest="graph_id", help="Graph ID to export annotations for")
    ed.add_argument(
        "--format",
        dest="fmt",
        default="jsonl",
        choices=["jsonl", "openai-ft", "csv"],
        help="Output format (default: jsonl)",
    )
    ed.add_argument("--output", type=Path, required=True, help="Output file path")
    ed.add_argument("--min-rating", type=int, default=None, dest="min_rating", help="Minimum annotation rating")
    ed.add_argument("--node-id", default=None, dest="node_id", help="Filter by node id")
    ed.add_argument("--since", default=None, help="Only annotations at or after this ISO date (e.g. 2026-01-01)")
    ed.add_argument("--labels", default=None, help="Comma-separated labels that must all be present")


def execute(args: argparse.Namespace) -> int:
    import json
    import sys
    from datetime import datetime, timezone

    from graph_caster.dataset_export import export_dataset

    workspace = Path(args.workspace).resolve()
    artifacts_base = workspace
    graph_id = str(args.graph_id).strip()
    output = Path(args.output)
    fmt = str(args.fmt)

    since = None
    if args.since:
        try:
            since = datetime.fromisoformat(str(args.since).replace("Z", "+00:00"))
            if since.tzinfo is None:
                since = since.replace(tzinfo=timezone.utc)
        except ValueError as e:
            print(f"export-dataset: invalid --since: {e}", file=sys.stderr)
            return 2

    labels: list[str] | None = None
    if args.labels:
        labels = [l.strip() for l in str(args.labels).split(",") if l.strip()]

    try:
        count = export_dataset(
            artifacts_base,
            graph_id,
            output,
            fmt=fmt,
            min_rating=args.min_rating,
            node_id=args.node_id,
            since=since,
            labels=labels,
        )
    except ValueError as e:
        print(f"export-dataset: {e}", file=sys.stderr)
        return 2

    print(json.dumps({"exported": count, "format": fmt, "output": str(output)}, ensure_ascii=False))
    return 0
