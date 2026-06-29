"""`audit` command — audit log utilities."""
from __future__ import annotations

import argparse
from pathlib import Path


def register(sub: argparse._SubParsersAction) -> None:
    aud = sub.add_parser("audit", help="Audit log utilities")
    aud_sub = aud.add_subparsers(dest="audit_command", required=True)

    aud_tail = aud_sub.add_parser("tail", help="Print the last N audit events from the JSONL log")
    aud_tail.add_argument(
        "--limit",
        type=int,
        default=50,
        help="Number of events to print (default 50)",
    )
    aud_tail.add_argument(
        "--log",
        default=None,
        dest="log_path",
        help="Path to audit JSONL log (default: GC_AUDIT_LOG_PATH env var)",
    )

    aud_query = aud_sub.add_parser("query", help="Query audit events with filters")
    aud_query.add_argument("--actor", default=None, help="Filter by actor")
    aud_query.add_argument("--action", default=None, help="Filter by action (e.g. graph.publish)")
    aud_query.add_argument("--target-kind", default=None, dest="target_kind", help="Filter by target_kind")
    aud_query.add_argument("--target-id", default=None, dest="target_id", help="Filter by target_id")
    aud_query.add_argument("--result", default=None, choices=["success", "failure"], help="Filter by result")
    aud_query.add_argument("--since", default=None, help="Only events at or after ISO datetime")
    aud_query.add_argument("--until", default=None, help="Only events at or before ISO datetime")
    aud_query.add_argument("--limit", type=int, default=100, help="Max events to return (default 100)")
    aud_query.add_argument("--cursor", default=None, help="Pagination cursor from previous query")
    aud_query.add_argument(
        "--log",
        default=None,
        dest="log_path",
        help="Path to audit JSONL log (default: GC_AUDIT_LOG_PATH env var)",
    )

    aud_verify = aud_sub.add_parser("verify", help="Verify tamper-evident chain hashes in the audit log")
    aud_verify.add_argument(
        "--log",
        default=None,
        dest="log_path",
        help="Path to audit JSONL log (default: GC_AUDIT_LOG_PATH env var)",
    )


def execute(args: argparse.Namespace) -> int:
    import asyncio as _asyncio
    import json
    import os as _os
    import sys

    from graph_caster.audit.audit_query import AuditQuery, verify_chain

    log_raw = getattr(args, "log_path", None) or _os.environ.get("GC_AUDIT_LOG_PATH", "").strip()
    if not log_raw:
        print("graph-caster audit: set --log or GC_AUDIT_LOG_PATH", file=sys.stderr)
        return 2

    log_path = Path(log_raw)

    if args.audit_command == "tail":
        limit = int(args.limit or 50)
        aq = AuditQuery(log_path)
        events, _cur = _asyncio.run(aq.query(limit=limit))
        for ev in events:
            print(json.dumps(ev.to_dict(), ensure_ascii=False, separators=(",", ":")))
        return 0

    if args.audit_command == "query":
        limit = int(args.limit or 100)
        aq = AuditQuery(log_path)
        events, next_cursor = _asyncio.run(
            aq.query(
                actor=getattr(args, "actor", None) or None,
                action=getattr(args, "action", None) or None,
                target_kind=getattr(args, "target_kind", None) or None,
                target_id=getattr(args, "target_id", None) or None,
                result=getattr(args, "result", None) or None,
                since=getattr(args, "since", None) or None,
                until=getattr(args, "until", None) or None,
                limit=limit,
                cursor=getattr(args, "cursor", None) or None,
            )
        )
        out = {"events": [e.to_dict() for e in events], "cursor": next_cursor}
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return 0

    if args.audit_command == "verify":
        errors = verify_chain(log_path)
        if not errors:
            print(json.dumps({"ok": True, "errors": []}, ensure_ascii=False))
            return 0
        print(json.dumps({"ok": False, "errors": errors}, ensure_ascii=False, indent=2))
        return 1

    return 2
