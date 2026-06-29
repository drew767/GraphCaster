"""`catalog-rebuild` command."""
from __future__ import annotations

import argparse
from pathlib import Path


def register(sub: argparse._SubParsersAction) -> None:
    cr = sub.add_parser(
        "catalog-rebuild",
        help="Rebuild SQLite run catalog from run-summary.json files under runs/",
    )
    cr.add_argument(
        "--artifacts-base",
        type=Path,
        required=True,
        help="Workspace root (parent of runs/)",
    )


def execute(args: argparse.Namespace) -> int:
    from graph_caster.run_catalog import rebuild_catalog_from_disk

    n = rebuild_catalog_from_disk(Path(args.artifacts_base))
    print(n)
    return 0
