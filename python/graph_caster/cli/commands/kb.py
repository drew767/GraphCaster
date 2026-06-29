"""`kb` command — knowledge-base / dataset management."""
from __future__ import annotations

import argparse
from pathlib import Path


def register(sub: argparse._SubParsersAction) -> None:
    kb = sub.add_parser("kb", help="Knowledge-base (Dataset) management")
    kb_sub = kb.add_subparsers(dest="kb_command", required=True)

    kb_create = kb_sub.add_parser("create", help="Create a new dataset")
    kb_create.add_argument("--name", required=True, help="Human-readable dataset name")
    kb_create.add_argument("--description", default="", help="Optional description")
    kb_create.add_argument(
        "--embedding-backend",
        default="hash",
        choices=["hash", "openai", "sentence_transformers"],
        dest="embedding_backend",
        help="Embedding backend (default: hash)",
    )
    kb_create.add_argument("--vector-backend", default="memory", dest="vector_backend",
                           choices=["memory", "chroma", "faiss"],
                           help="Vector store backend (default: memory)")
    kb_create.add_argument("--workspace", type=Path, default=Path("."), help="Workspace root")

    kb_list = kb_sub.add_parser("list", help="List datasets in workspace")
    kb_list.add_argument("--workspace", type=Path, default=Path("."), help="Workspace root")

    kb_add = kb_sub.add_parser("add", help="Add a document file to a dataset")
    kb_add.add_argument("dataset_id", help="Dataset ID")
    kb_add.add_argument("--source", required=True, help="Path or URL label for the document")
    kb_add.add_argument("--workspace", type=Path, default=Path("."), help="Workspace root")

    kb_query = kb_sub.add_parser("query", help="Query a dataset")
    kb_query.add_argument("dataset_id", help="Dataset ID")
    kb_query.add_argument("text", help="Query text")
    kb_query.add_argument("--top-k", type=int, default=5, dest="top_k", help="Number of results (default 5)")
    kb_query.add_argument(
        "--mode",
        default="vector",
        choices=["vector", "keyword", "hybrid", "full_text", "multiway"],
        help="Retrieval mode (default: vector)",
    )
    kb_query.add_argument(
        "--alpha",
        type=float,
        default=0.5,
        dest="hybrid_alpha",
        help="Hybrid vector weight 0-1 (default 0.5); only used with --mode hybrid",
    )
    kb_query.add_argument(
        "--rerank",
        default=None,
        dest="reranker",
        metavar="RERANKER",
        help="Apply reranker after retrieval: cohere or bge",
    )
    kb_query.add_argument(
        "--rerank-top-n",
        type=int,
        default=None,
        dest="rerank_top_n",
        help="Fetch this many candidates before reranking, then trim to --top-k",
    )
    kb_query.add_argument(
        "--score-threshold",
        type=float,
        default=None,
        dest="score_threshold",
        help="Exclude results with score below this value",
    )
    kb_query.add_argument("--workspace", type=Path, default=Path("."), help="Workspace root")
    kb_query.add_argument(
        "--cite",
        action="store_true",
        default=False,
        help="After retrieval, call an LLM with citation instructions and print cited answer",
    )
    kb_query.add_argument(
        "--provider",
        default=None,
        dest="cite_provider",
        metavar="PROVIDER",
        help="LLM provider name for --cite (e.g. openai, anthropic); must be registered",
    )
    kb_query.add_argument(
        "--model",
        default=None,
        dest="cite_model",
        metavar="MODEL",
        help="Model identifier for --cite (e.g. gpt-4o)",
    )

    kb_delete = kb_sub.add_parser("delete", help="Delete a dataset")
    kb_delete.add_argument("dataset_id", help="Dataset ID")
    kb_delete.add_argument("--workspace", type=Path, default=Path("."), help="Workspace root")


def execute(args: argparse.Namespace) -> int:
    import asyncio
    import json
    import sys

    from graph_caster.rag.dataset import Dataset

    workspace = Path(args.workspace).resolve()

    if args.kb_command == "create":
        ds = Dataset.create(
            workspace,
            args.name,
            description=args.description,
            embedding_backend=args.embedding_backend,
            vector_backend=args.vector_backend,
        )
        print(json.dumps(ds.metadata.to_dict(), ensure_ascii=False, indent=2))
        return 0

    if args.kb_command == "list":
        metas = Dataset.list(workspace)
        print(json.dumps([m.to_dict() for m in metas], ensure_ascii=False, indent=2))
        return 0

    if args.kb_command == "add":
        try:
            ds = Dataset.open(workspace, args.dataset_id)
        except FileNotFoundError as e:
            print(str(e), file=sys.stderr)
            return 2
        source_path = Path(args.source)
        if source_path.exists():
            content = source_path.read_text(encoding="utf-8")
        else:
            content = args.source
        doc_id = asyncio.run(ds.add_document(args.source, content))
        print(json.dumps({"doc_id": doc_id, "source": args.source}, ensure_ascii=False))
        return 0

    if args.kb_command == "query":
        try:
            ds = Dataset.open(workspace, args.dataset_id)
        except FileNotFoundError as e:
            print(str(e), file=sys.stderr)
            return 2
        from graph_caster.rag.retrieval import RetrievalConfig, RetrievalMode
        cfg = RetrievalConfig(
            mode=RetrievalMode(getattr(args, "mode", "vector")),
            top_k=args.top_k,
            hybrid_alpha=float(getattr(args, "hybrid_alpha", 0.5)),
            reranker=getattr(args, "reranker", None),
            rerank_top_n=getattr(args, "rerank_top_n", None),
            score_threshold=getattr(args, "score_threshold", None),
        )

        want_cite = getattr(args, "cite", False)
        if want_cite:
            prov_name = getattr(args, "cite_provider", None)
            model_name = getattr(args, "cite_model", None)
            if not prov_name:
                print("--cite requires --provider", file=sys.stderr)
                return 2
            if not model_name:
                print("--cite requires --model", file=sys.stderr)
                return 2
            from graph_caster.llm import _auto_register_all, get_default_registry
            from graph_caster.rag.citations import cited_query
            _auto_register_all()
            try:
                provider = get_default_registry().get(prov_name)
            except KeyError as exc:
                print(str(exc), file=sys.stderr)
                return 2
            cited = asyncio.run(cited_query(
                ds,
                args.text,
                provider=provider,
                model=model_name,
                retrieval_config=cfg,
            ))
            print(f"Answer: {cited.text}")
            if cited.citations:
                print("Citations:")
                for c in cited.citations:
                    page_str = f", page: {c.page}" if c.page is not None else ""
                    print(f"  [{c.index}] source: {c.source}{page_str} — \"{c.text}\"")
            if cited.unmatched_citations:
                print(f"Unmatched indices: {cited.unmatched_citations}", file=sys.stderr)
            return 0

        results = asyncio.run(ds.query(args.text, config=cfg))
        serializable = [r.to_dict() if hasattr(r, "to_dict") else r for r in results]
        print(json.dumps(serializable, ensure_ascii=False, indent=2))
        return 0

    if args.kb_command == "delete":
        try:
            ds = Dataset.open(workspace, args.dataset_id)
        except FileNotFoundError as e:
            print(str(e), file=sys.stderr)
            return 2
        ds.delete()
        print(json.dumps({"deleted": args.dataset_id}, ensure_ascii=False))
        return 0

    return 2
