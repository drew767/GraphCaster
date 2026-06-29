"""`rag` command — RAG record manager utilities."""
from __future__ import annotations

import argparse
from pathlib import Path


def register(sub: argparse._SubParsersAction) -> None:
    rag = sub.add_parser("rag", help="RAG record manager utilities")
    rag_sub = rag.add_subparsers(dest="rag_command", required=True)

    rag_rec = rag_sub.add_parser("records", help="Document record management")
    rag_rec_sub = rag_rec.add_subparsers(dest="records_command", required=True)

    rag_rec_list = rag_rec_sub.add_parser("list", help="List all document records in a RecordManager root")
    rag_rec_list.add_argument("--root", type=Path, required=True, help="FileRecordManager root directory")

    rag_rec_show = rag_rec_sub.add_parser("show", help="Show a single document record")
    rag_rec_show.add_argument("doc_id", help="Document ID")
    rag_rec_show.add_argument("--root", type=Path, required=True, help="FileRecordManager root directory")

    rag_rec_delete = rag_rec_sub.add_parser("delete", help="Delete a document record")
    rag_rec_delete.add_argument("doc_id", help="Document ID")
    rag_rec_delete.add_argument("--root", type=Path, required=True, help="FileRecordManager root directory")


def execute(args: argparse.Namespace) -> int:
    import asyncio
    import json
    import sys

    from graph_caster.rag.record_manager import FileRecordManager

    if args.rag_command != "records":
        print("graph-caster rag: unknown subcommand", file=sys.stderr)
        return 2

    root = Path(args.root).resolve()
    manager = FileRecordManager(root)

    if args.records_command == "list":
        records = asyncio.run(manager.list_all())
        print(json.dumps([r.to_dict() for r in records], ensure_ascii=False, indent=2))
        return 0

    if args.records_command == "show":
        record = asyncio.run(manager.get(args.doc_id))
        if record is None:
            print(f"record not found: {args.doc_id}", file=sys.stderr)
            return 1
        print(json.dumps(record.to_dict(), ensure_ascii=False, indent=2))
        return 0

    if args.records_command == "delete":
        asyncio.run(manager.delete(args.doc_id))
        print(json.dumps({"deleted": args.doc_id}, ensure_ascii=False))
        return 0

    return 2
