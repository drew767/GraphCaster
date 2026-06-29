"""`replay` command — deterministic trace replay."""
from __future__ import annotations

import argparse
from pathlib import Path


def register(sub: argparse._SubParsersAction) -> None:
    rpl = sub.add_parser(
        "replay",
        help="Re-execute a previous run from its first failure (or an explicit node)",
    )
    rpl.add_argument("run_id", help="Run ID of the previous run to replay")
    rpl.add_argument(
        "--workspace",
        type=Path,
        default=Path("."),
        help="Workspace root (parent of runs/ and graphs/; default: current directory)",
    )
    rpl.add_argument(
        "--start-from",
        dest="start_from",
        default=None,
        metavar="NODE_ID",
        help="Start replay from this node (default: auto-detect first failed/incomplete node)",
    )
    rpl.add_argument(
        "--dry-run",
        action="store_true",
        dest="dry_run",
        help="Print the replay plan as JSON and exit without executing",
    )
    rpl.add_argument(
        "--override",
        default=None,
        metavar="JSON",
        help='Override pinned outputs before replay, e.g. \'{"nodeA.result":42}\'',
    )


def execute(args: argparse.Namespace) -> int:
    import asyncio as _asyncio_replay
    import json
    import sys

    from graph_caster.replay import ReplayManager, ReplayError

    workspace = Path(args.workspace).resolve()
    run_id = str(args.run_id).strip()
    if not run_id:
        print("replay: run_id must not be empty", file=sys.stderr)
        return 2

    start_from: str | None = args.start_from
    dry_run: bool = bool(args.dry_run)

    override_inputs: dict | None = None
    if args.override:
        try:
            override_inputs = json.loads(str(args.override))
            if not isinstance(override_inputs, dict):
                print("replay: --override must be a JSON object", file=sys.stderr)
                return 2
        except json.JSONDecodeError as exc:
            print(f"replay: invalid --override JSON: {exc}", file=sys.stderr)
            return 2

    mgr = ReplayManager(workspace)

    try:
        plan = _asyncio_replay.run(
            mgr.build_plan(run_id, start_from=start_from, override_inputs=override_inputs)
        )
    except ReplayError as exc:
        print(f"replay: {exc}", file=sys.stderr)
        return 2

    if dry_run:
        print(json.dumps(plan.to_dict(), ensure_ascii=False, indent=2))
        return 0

    try:
        new_run_id = _asyncio_replay.run(mgr.execute(plan, override_inputs=override_inputs))
    except ReplayError as exc:
        print(f"replay: execute failed: {exc}", file=sys.stderr)
        return 2

    print(json.dumps({"newRunId": new_run_id, "replayOf": run_id}, ensure_ascii=False))
    return 0
