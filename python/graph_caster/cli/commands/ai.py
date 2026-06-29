"""`ai-build` and `ai-refine` commands."""
from __future__ import annotations

import argparse
from pathlib import Path


def register(sub: argparse._SubParsersAction) -> None:
    aib = sub.add_parser(
        "ai-build",
        help="Generate a graph document from a natural-language description (F91)",
    )
    aib_desc = aib.add_mutually_exclusive_group(required=True)
    aib_desc.add_argument("description", nargs="?", default=None, help="Natural-language description")
    aib_desc.add_argument(
        "--from-file",
        dest="from_file",
        type=Path,
        default=None,
        metavar="FILE",
        help="Read description from a text file",
    )
    aib.add_argument("--provider", default="openai", help="LLM provider name (default: openai)")
    aib.add_argument("--model", default="gpt-4o", help="LLM model name (default: gpt-4o)")
    aib.add_argument(
        "--refine-iterations",
        type=int,
        default=1,
        dest="refine_iterations",
        metavar="N",
        help="Max refinement iterations on validation failure (default: 1)",
    )
    aib.add_argument(
        "--output",
        "-o",
        type=Path,
        default=None,
        help="Write graph JSON to this file (default: stdout)",
    )

    air = sub.add_parser(
        "ai-refine",
        help="Refine an existing graph document with natural-language feedback (F91)",
    )
    air.add_argument("graph_file", type=Path, help="Path to existing graph JSON file")
    air.add_argument(
        "--feedback",
        required=True,
        help="Natural-language feedback / change request",
    )
    air.add_argument("--provider", default="openai", help="LLM provider name (default: openai)")
    air.add_argument("--model", default="gpt-4o", help="LLM model name (default: gpt-4o)")
    air.add_argument(
        "--output",
        "-o",
        type=Path,
        default=None,
        help="Write refined graph JSON to this file (default: overwrite graph_file)",
    )


def execute(args: argparse.Namespace) -> int:
    import sys

    if args.command == "ai-build":
        return _exec_build(args)
    if args.command == "ai-refine":
        return _exec_refine(args)
    print(f"ai: unknown command {args.command!r}", file=sys.stderr)
    return 2


def _exec_build(args: argparse.Namespace) -> int:
    import asyncio as _asyncio_aib
    import json
    import sys

    from graph_caster.ai_builder import AIWorkflowBuilder
    from graph_caster.llm import _auto_register_all

    _auto_register_all()

    if getattr(args, "from_file", None) is not None:
        try:
            description = Path(args.from_file).read_text(encoding="utf-8")
        except OSError as exc:
            print(f"ai-build: cannot read --from-file: {exc}", file=sys.stderr)
            return 2
    elif getattr(args, "description", None):
        description = str(args.description)
    else:
        print("ai-build: provide a description or --from-file", file=sys.stderr)
        return 2

    builder = AIWorkflowBuilder(
        provider=str(args.provider or "openai"),
        model=str(args.model or "gpt-4o"),
    )

    result = _asyncio_aib.run(
        builder.build(
            description,
            refine_iterations=int(args.refine_iterations or 1),
        )
    )

    if result.validation_errors:
        print("ai-build: graph has validation errors:", file=sys.stderr)
        for _ve in result.validation_errors:
            print(f"  - {_ve}", file=sys.stderr)

    print("", file=sys.stderr)
    print(f"Rationale: {result.rationale}", file=sys.stderr)
    if result.tokens_used:
        print(f"Tokens used: {json.dumps(result.tokens_used)}", file=sys.stderr)

    graph_json = json.dumps(result.graph, ensure_ascii=False, indent=2)
    output_path = getattr(args, "output", None)
    if output_path is not None:
        try:
            Path(output_path).write_text(graph_json + chr(10), encoding="utf-8")
            print(f"ai-build: wrote graph to {output_path}", file=sys.stderr)
        except OSError as exc:
            print(f"ai-build: cannot write output: {exc}", file=sys.stderr)
            return 2
    else:
        print(graph_json)

    return 0 if not result.validation_errors else 1


def _exec_refine(args: argparse.Namespace) -> int:
    import asyncio as _asyncio_air
    import json
    import sys

    from graph_caster.ai_builder import AIWorkflowBuilder
    from graph_caster.llm import _auto_register_all

    _auto_register_all()

    graph_path = Path(args.graph_file)
    try:
        prior_graph = json.loads(graph_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"ai-refine: cannot read graph file: {exc}", file=sys.stderr)
        return 2

    builder = AIWorkflowBuilder(
        provider=str(args.provider or "openai"),
        model=str(args.model or "gpt-4o"),
    )

    result = _asyncio_air.run(builder.refine(prior_graph, str(args.feedback)))

    if result.validation_errors:
        print("ai-refine: refined graph has validation errors:", file=sys.stderr)
        for _ve in result.validation_errors:
            print(f"  - {_ve}", file=sys.stderr)

    print("", file=sys.stderr)
    print(f"Rationale: {result.rationale}", file=sys.stderr)
    if result.tokens_used:
        print(f"Tokens used: {json.dumps(result.tokens_used)}", file=sys.stderr)

    graph_json = json.dumps(result.graph, ensure_ascii=False, indent=2)
    output_path = getattr(args, "output", None) or graph_path
    try:
        Path(output_path).write_text(graph_json + chr(10), encoding="utf-8")
        print(f"ai-refine: wrote refined graph to {output_path}", file=sys.stderr)
    except OSError as exc:
        print(f"ai-refine: cannot write output: {exc}", file=sys.stderr)
        return 2

    return 0 if not result.validation_errors else 1
