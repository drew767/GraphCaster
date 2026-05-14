# Copyright GraphCaster. All Rights Reserved.

from __future__ import annotations

import argparse
import copy
import json
import os
import sys
import threading
from pathlib import Path

from graph_caster.host_context import RunHostContext
from graph_caster.models import GraphDocument
from graph_caster.run_event_sink import NdjsonStdoutSink, NodeExecutePublicStreamSink
from graph_caster.runner import GraphRunner
from graph_caster.run_sessions import RunSessionRegistry, get_default_run_registry
from graph_caster.nested_run_subprocess import NESTED_CONTEXT_INPUT_KEYS, write_nested_run_result_json
from graph_caster.validate import GraphStructureError, validate_graph_structure

_SUBCOMMANDS = frozenset(
    {
        "run",
        "artifacts-size",
        "artifacts-clear",
        "catalog-rebuild",
        "serve",
        "worker",
        "mcp",
        "mcp-oauth",
        "export-mcp",
        "kb",
        "vars",
        "composio",
        "export-dataset",
        "rag",
        "publish",
        "versions",
        "rollback",
        "ai-build",
        "ai-refine",
        "openapi",
        "tools",
        "audit",
        "tenant",
        "user",
        "member",
        "auth",
        "replay",
        "rbac",
        "collab",
        "plugin",
        "registry",
        "share",
        "resume",
    }
)


def _spawn_stdin_cancel_loop(registry: RunSessionRegistry) -> None:
    def loop() -> None:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError as exc:
                if os.environ.get("GC_CONTROL_STDIN_DEBUG", "").strip():
                    print(f"graph-caster: control-stdin JSON skip: {exc}", file=sys.stderr, flush=True)
                continue
            if obj.get("type") != "cancel_run":
                continue
            rid = obj.get("runId") if "runId" in obj else obj.get("run_id")
            if rid is not None and str(rid).strip():
                registry.request_cancel(str(rid).strip())

    threading.Thread(target=loop, daemon=True).start()


def _normalize_argv(argv: list[str]) -> list[str]:
    if not argv:
        return argv
    if argv[0] in _SUBCOMMANDS or argv[0] in ("-h", "--help"):
        return argv
    if "-d" in argv or "--document" in argv:
        return ["run"] + argv
    return argv


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="graph-caster", description="GraphCaster Python runner")
    sub = parser.add_subparsers(dest="command", required=True)

    run = sub.add_parser("run", help="Execute a graph document (stream NDJSON events to stdout)")
    run.add_argument("--document", "-d", type=Path, required=True, help="Path to graph JSON document")
    run.add_argument(
        "--start",
        "-s",
        default="",
        help="Override entry node id (default: validate and use the single 'start' node)",
    )
    run.add_argument(
        "--graphs-dir",
        "-g",
        type=Path,
        default=None,
        help="Directory of *.json graphs for graph_ref resolution (graphId → file)",
    )
    run.add_argument(
        "--workspace-root",
        type=Path,
        default=None,
        help="Workspace root for .graphcaster/workspace.secrets.env; if omitted, parent of --graphs-dir is used when -g is set",
    )
    run.add_argument(
        "--artifacts-base",
        type=Path,
        default=None,
        help="Workspace root under which runs/<graphId>/<timestamp>/ is created for this run",
    )
    run.add_argument(
        "--no-persist-run-events",
        action="store_true",
        help="Disable writing events.ndjson and run-summary.json under the run dir (default: persist when --artifacts-base is set)",
    )
    run.add_argument(
        "--track-session",
        action="store_true",
        help="Register this root run in the process-wide session registry (for cancel / inspection APIs)",
    )
    run.add_argument(
        "--control-stdin",
        action="store_true",
        help="Read NDJSON lines from stdin (same process) with {type:\"cancel_run\",runId:\"...\"} — requires --track-session (Dify-style command channel)",
    )
    run.add_argument(
        "--run-id",
        default=None,
        help="Fixed root run UUID string (so cancel_run can target this run); default is generated",
    )
    run.add_argument(
        "--until-node",
        default=None,
        metavar="NODE_ID",
        help="Stop after this node completes successfully (run still starts at the document start node; --start is ignored)",
    )
    run.add_argument(
        "--context-json",
        type=Path,
        default=None,
        help="Merge node_outputs from this JSON object (key node_outputs: { nodeId: … }) into run context before start",
    )
    run.add_argument(
        "--use-pins",
        action="store_true",
        default=False,
        help=(
            "F48: auto-populate ancestor node outputs from each ancestor's gcPin.payload "
            "before a mid-graph --start run (requires --start)"
        ),
    )
    run.add_argument(
        "--pins-from-run",
        default=None,
        metavar="RUN_ID",
        help=(
            "F48: load pinned outputs from a previous run's events.ndjson (identified by run ID); "
            "requires --artifacts-base so the runs/ tree can be scanned"
        ),
    )
    run.add_argument(
        "--pin-output",
        action="append",
        default=[],
        metavar="nodeId:jsonPath:value",
        dest="pin_outputs",
        help=(
            "F48: explicit per-node output override in the form nodeId:key:jsonValue "
            "(can repeat); takes priority over --use-pins and --pins-from-run"
        ),
    )
    run.add_argument(
        "--nested-context-out",
        type=Path,
        default=None,
        help=argparse.SUPPRESS,
    )
    run.add_argument(
        "--step-cache",
        action="store_true",
        help="Enable cross-run step cache for task nodes with data.stepCache (requires --artifacts-base)",
    )
    run.add_argument(
        "--step-cache-dirty",
        default="",
        metavar="NODE_IDS",
        help="Comma-separated node ids that skip cache read (re-exec like n8n dirtyNodeNames); requires --step-cache",
    )
    run.add_argument(
        "--step-cache-strategy",
        default="id",
        choices=["id", "input-signature", "lru"],
        metavar="STRATEGY",
        help=(
            "Cache key strategy when --step-cache is set: "
            "'id' (default, original behavior), "
            "'input-signature' (ComfyUI-style ancestor hash — survives graph restructuring), "
            "'lru' (id strategy with in-process LRU eviction, size controlled by --step-cache-lru-max)"
        ),
    )
    run.add_argument(
        "--step-cache-lru-max",
        type=int,
        default=1024,
        metavar="N",
        help="Max entries for LRU in-process cache when --step-cache-strategy=lru (default 1024)",
    )
    run.add_argument(
        "--fork-max-parallel",
        type=int,
        default=None,
        metavar="N",
        help="Upper bound on parallel fork branches (>=1); also fork.data.maxParallel and GC_FORK_MAX_PARALLEL; default 1 is sequential",
    )
    run.add_argument(
        "--public-stream",
        action="store_true",
        help=(
            "Omit node_execute data from stdout NDJSON (metadata only); run dir events.ndjson still "
            "receives full redacted payloads when --artifacts-base is set. Also set via GC_PUBLIC_RUN_STREAM."
        ),
    )
    run.add_argument(
        "--scheduler",
        default=None,
        choices=["fifo", "ux-friendly"],
        metavar="MODE",
        help=(
            "Node pick order: 'ux-friendly' (default) picks output/exit/async nodes first so the "
            "user sees results sooner; 'fifo' preserves strict insertion order. "
            "Also controlled by env GC_SCHEDULER_UX_FRIENDLY=on|off."
        ),
    )

    sz = sub.add_parser("artifacts-size", help="Print total artifact size in bytes under runs/")
    sz.add_argument("--base", type=Path, required=True, help="Workspace root (parent of runs/)")
    sz.add_argument(
        "--graph-id",
        default=None,
        help="If set, size only runs/<graphId>/; else entire runs/ tree",
    )

    cl = sub.add_parser("artifacts-clear", help="Delete artifact directories under runs/")
    cl.add_argument("--base", type=Path, required=True, help="Workspace root (parent of runs/)")
    g = cl.add_mutually_exclusive_group(required=True)
    g.add_argument("--graph-id", default=None, help="Remove runs/<graphId>/ only")
    g.add_argument("--all", action="store_true", help="Remove entire runs/ directory")

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

    srv = sub.add_parser(
        "serve",
        help="HTTP+SSE dev broker for web UI (wraps graph_caster run in a subprocess)",
    )
    srv.add_argument("--host", default="127.0.0.1", help="Bind address")
    srv.add_argument("--port", type=int, default=9847, help="Listen port")

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

    mcp = sub.add_parser(
        "mcp",
        help="Model Context Protocol server (stdio): tools to list/run graphs (requires pip install -e '.[mcp]')",
    )
    mcp.add_argument(
        "--graphs-dir",
        "-g",
        type=Path,
        required=True,
        help="Directory of *.json graphs (same as run -g)",
    )
    mcp.add_argument(
        "--workspace-root",
        type=Path,
        default=None,
        help="Workspace root for .graphcaster/workspace.secrets.env",
    )
    mcp.add_argument(
        "--artifacts-base",
        type=Path,
        default=None,
        help="Optional workspace root for runs/<graphId>/… (persist run-summary when set)",
    )
    mcp.add_argument(
        "--per-graph-tools",
        action="store_true",
        default=False,
        help="Also expose one gc_<graphId> tool per discovered graph (F65)",
    )
    mcp.add_argument(
        "--watch",
        action="store_true",
        default=False,
        help="Hot-reload: poll graphs directory every 10 s and register new per-graph tools (requires --per-graph-tools)",
    )

    em = sub.add_parser(
        "export-mcp",
        help="Start a minimal MCP server exposing only one graph as a tool (requires pip install -e '.[mcp]')",
    )
    em.add_argument(
        "graph_id",
        help="Graph ID to export",
    )
    em.add_argument(
        "--graphs-dir",
        "-g",
        type=Path,
        required=True,
        help="Directory of *.json graphs",
    )
    em.add_argument(
        "--workspace-root",
        type=Path,
        default=None,
        help="Workspace root for .graphcaster/workspace.secrets.env",
    )
    em.add_argument(
        "--artifacts-base",
        type=Path,
        default=None,
        help="Optional workspace root for runs/<graphId>/… (persist run-summary when set)",
    )
    em.add_argument(
        "--bind",
        default="stdio",
        choices=["stdio", "http"],
        help="Transport: stdio (default) or http",
    )
    em.add_argument(
        "--port",
        type=int,
        default=8765,
        help="HTTP port when --bind=http (default 8765)",
    )

    mo = sub.add_parser(
        "mcp-oauth",
        help="OAuth token helpers for streamable HTTP MCP (e.g. GitHub device flow)",
    )
    mo_sub = mo.add_subparsers(dest="oauth_cmd", required=True)
    mo_gh = mo_sub.add_parser(
        "github-device",
        help="Run GitHub OAuth device flow; prints access token (for bearerEnvKey / workspace secrets)",
    )
    mo_gh.add_argument(
        "--scope",
        default="",
        help="OAuth scopes (space-separated), e.g. read:user repo",
    )
    mo_gh.add_argument(
        "--client-id",
        default=None,
        help="OAuth App client id (default: env GITHUB_OAUTH_CLIENT_ID)",
    )

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

    # --- vars subcommand (F101: lifecycle variables) ---
    vr = sub.add_parser("vars", help="Manage scoped variables (run/session/tenant/env)")
    vr_sub = vr.add_subparsers(dest="vars_command", required=True)

    vr_set = vr_sub.add_parser("set", help="Set a variable in scope.name form")
    vr_set.add_argument("key", help="Variable reference, e.g. tenant.api_endpoint")
    vr_set.add_argument("value", help="Value (JSON-decoded if valid, else stored as string)")
    vr_set.add_argument("--workspace", type=Path, default=Path("."), help="Workspace root")
    vr_set.add_argument("--tenant", default="default", help="Tenant id (default: default)")

    vr_get = vr_sub.add_parser("get", help="Get a variable value")
    vr_get.add_argument("key", help="Variable reference in scope.name form")
    vr_get.add_argument("--workspace", type=Path, default=Path("."))
    vr_get.add_argument("--tenant", default="default")

    vr_list = vr_sub.add_parser("list", help="List all variables in a scope")
    vr_list.add_argument(
        "--scope",
        required=True,
        choices=["sys", "run", "session", "conv", "tenant", "env"],
        help="Scope to list",
    )
    vr_list.add_argument("--workspace", type=Path, default=Path("."))
    vr_list.add_argument("--tenant", default="default")

    vr_del = vr_sub.add_parser("delete", help="Delete a variable")
    vr_del.add_argument("key", help="Variable reference in scope.name form")
    vr_del.add_argument("--workspace", type=Path, default=Path("."))
    vr_del.add_argument("--tenant", default="default")

    # --- composio subcommand (F66: Composio integrations bridge) ---
    cmp = sub.add_parser(
        "composio",
        help="Composio integrations bridge (requires pip install -e '.[composio]')",
    )
    cmp_sub = cmp.add_subparsers(dest="composio_command", required=True)

    cmp_apps = cmp_sub.add_parser("list-apps", help="List enabled Composio apps")
    cmp_apps.add_argument("--workspace", type=Path, default=None, help="Workspace root for secret resolution")

    cmp_actions = cmp_sub.add_parser("list-actions", help="List available Composio actions")
    cmp_actions.add_argument("--app", default=None, help="Filter by app name (e.g. GITHUB)")
    cmp_actions.add_argument("--workspace", type=Path, default=None, help="Workspace root for secret resolution")

    cmp_schema = cmp_sub.add_parser("schema", help="Print JSON schema for a Composio action")
    cmp_schema.add_argument("action", help="Action name, e.g. GITHUB_CREATE_ISSUE")
    cmp_schema.add_argument("--workspace", type=Path, default=None, help="Workspace root for secret resolution")

    cmp_invoke = cmp_sub.add_parser("invoke", help="Invoke a Composio action")
    cmp_invoke.add_argument("action", help="Action name, e.g. SLACK_SEND_MESSAGE")
    cmp_invoke.add_argument("--params", default="{}", help="JSON-encoded params dict")
    cmp_invoke.add_argument("--entity-id", default="default", dest="entity_id", help="Composio entity ID")
    cmp_invoke.add_argument("--workspace", type=Path, default=None, help="Workspace root for secret resolution")

    # --- export-dataset subcommand (F55: annotations + dataset export) ---
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

    # --- rag subcommand (F62: RecordManager CLI) ---
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

    # --- publish subcommand (F49: Draft/Publish versioning) ---
    pub = sub.add_parser("publish", help="Publish current draft as an immutable version snapshot")
    pub.add_argument("graph_id", help="Graph ID to publish")
    pub.add_argument("--message", default="", help="Release message (optional)")
    pub.add_argument("--author", default="", help="Author name (optional)")
    pub.add_argument(
        "--workspace",
        type=Path,
        default=Path("."),
        help="Workspace root (parent of graphs/ and versions/)",
    )

    # --- versions subcommand (F49) ---
    vrs = sub.add_parser("versions", help="Manage published graph versions")
    vrs_sub = vrs.add_subparsers(dest="versions_command", required=True)

    vrs_list = vrs_sub.add_parser("list", help="List all published versions for a graph")
    vrs_list.add_argument("graph_id", help="Graph ID")
    vrs_list.add_argument("--workspace", type=Path, default=Path("."), help="Workspace root")

    vrs_show = vrs_sub.add_parser("show", help="Show metadata + document for a published version")
    vrs_show.add_argument("graph_id", help="Graph ID")
    vrs_show.add_argument("version", type=int, help="Version number")
    vrs_show.add_argument("--workspace", type=Path, default=Path("."), help="Workspace root")

    vrs_diff = vrs_sub.add_parser("diff", help="Diff two versions (use 'draft' or a version number)")
    vrs_diff.add_argument("graph_id", help="Graph ID")
    vrs_diff.add_argument("a", help="Version number A or 'draft'")
    vrs_diff.add_argument("b", help="Version number B or 'draft'")
    vrs_diff.add_argument("--workspace", type=Path, default=Path("."), help="Workspace root")

    # --- rollback subcommand (F49) ---
    rb = sub.add_parser("rollback", help="Overwrite draft with a published version snapshot")
    rb.add_argument("graph_id", help="Graph ID")
    rb.add_argument("version", type=int, help="Version number to restore")
    rb.add_argument("--workspace", type=Path, default=Path("."), help="Workspace root")

    # --- ai-build subcommand (F91) ---
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

    # --- ai-refine subcommand (F91) ---
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

    # --- tools subcommand (F64: built-in tool registry) ---
    tl = sub.add_parser("tools", help="Built-in tool registry (F64)")
    tl_sub = tl.add_subparsers(dest="tools_command", required=True)

    tl_sub.add_parser("list", help="List all built-in tools")

    tl_show = tl_sub.add_parser("show", help="Show details for a built-in tool")
    tl_show.add_argument("tool_name", help="Tool name, e.g. calc")

    tl_invoke = tl_sub.add_parser("invoke", help="Invoke a built-in tool")
    tl_invoke.add_argument("tool_name", help="Tool name, e.g. calc")
    tl_invoke.add_argument(
        "--args",
        default="{}",
        help="JSON-encoded arguments dict (default: {})",
    )


    # --- openapi subcommand (F63: OpenAPI import / invoke) ---
    oa = sub.add_parser("openapi", help="OpenAPI / Swagger spec tools: inspect, list-operations, invoke")
    oa_sub = oa.add_subparsers(dest="openapi_command", required=True)

    oa_inspect = oa_sub.add_parser("inspect", help="Print parsed operations from a spec (JSON array)")
    oa_inspect.add_argument("spec", help="URL or path to OpenAPI JSON spec")
    oa_inspect.add_argument("--base-url", default=None, dest="base_url", help="Override base URL")

    oa_list = oa_sub.add_parser("list-operations", help="List operation IDs from a spec")
    oa_list.add_argument("spec", help="URL or path to OpenAPI JSON spec")
    oa_list.add_argument("--base-url", default=None, dest="base_url", help="Override base URL")

    oa_invoke = oa_sub.add_parser("invoke", help="Invoke a single operation from a spec")
    oa_invoke.add_argument("spec", help="URL or path to OpenAPI JSON spec")
    oa_invoke.add_argument("--op", required=True, dest="operation_id", help="operationId to invoke")
    oa_invoke.add_argument("--args", default="{}", dest="args_json", help="JSON object of arguments")
    oa_invoke.add_argument("--base-url", default=None, dest="base_url", help="Override base URL")
    oa_invoke.add_argument(
        "--timeout", type=float, default=30.0, dest="timeout_sec", help="Request timeout in seconds"
    )

    # --- audit subcommand (F87: Audit log enforcement) ---
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

    # --- tenant subcommand ---
    ten = sub.add_parser("tenant", help="Manage tenants (F83 multi-tenant model)")
    ten_sub = ten.add_subparsers(dest="tenant_cmd", required=True)

    ten_create = ten_sub.add_parser("create", help="Create a new tenant")
    ten_create.add_argument("--name", required=True, help="Tenant display name")
    ten_create.add_argument("--plan", default="default", help="Plan name (default: default)")

    ten_sub.add_parser("list", help="List all tenants in the default store")

    ten_info = ten_sub.add_parser("info", help="Show tenant details")
    ten_info.add_argument("tenant_id", help="Tenant ID")

    # --- user subcommand ---
    usr = sub.add_parser("user", help="Manage users (F83 multi-tenant model)")
    usr_sub = usr.add_subparsers(dest="user_cmd", required=True)

    usr_create = usr_sub.add_parser("create", help="Create a new user")
    usr_create.add_argument("--email", required=True, help="User email")
    usr_create.add_argument("--name", required=True, help="User display name")
    usr_create.add_argument("--password", default=None, help="Password (omit for SSO-only)")

    usr_sub.add_parser("list", help="List all users in the default store")

    # --- member subcommand ---
    mem = sub.add_parser("member", help="Manage tenant memberships (F83 multi-tenant model)")
    mem_sub = mem.add_subparsers(dest="member_cmd", required=True)

    mem_add = mem_sub.add_parser("add", help="Add a member to a tenant")
    mem_add.add_argument("tenant_id", help="Tenant ID")
    mem_add.add_argument("--email", required=True, help="User email")
    mem_add.add_argument("--role", default="viewer",
                         choices=["owner", "admin", "editor", "viewer", "dataset_operator"])

    mem_list = mem_sub.add_parser("list", help="List members of a tenant")
    mem_list.add_argument("tenant_id", help="Tenant ID")

    mem_remove = mem_sub.add_parser("remove", help="Remove a member from a tenant")
    mem_remove.add_argument("tenant_id", help="Tenant ID")
    mem_remove.add_argument("--email", required=True, help="User email")

    # --- auth sso subcommand (F85) ---
    auth_cmd = sub.add_parser("auth", help="Authentication utilities (SSO/OAuth2 providers)")
    auth_sub = auth_cmd.add_subparsers(dest="auth_command", required=True)

    auth_sso = auth_sub.add_parser("sso", help="SSO / OAuth2 provider management")
    auth_sso_sub = auth_sso.add_subparsers(dest="sso_command", required=True)

    auth_sso_sub.add_parser("providers", help="List configured SSO providers")

    auth_cfg = auth_sso_sub.add_parser("configure", help="Persist OAuth provider credentials to ~/.graphcaster/oauth.json")
    auth_cfg.add_argument("provider", choices=["google", "github", "microsoft", "oidc"], help="Provider name")
    auth_cfg.add_argument("--client-id", required=True, dest="client_id", help="OAuth client ID")
    auth_cfg.add_argument("--client-secret", required=True, dest="client_secret", help="OAuth client secret")
    auth_cfg.add_argument("--redirect-uri", required=True, dest="redirect_uri", help="Redirect URI")
    auth_cfg.add_argument("--scopes", default="", help="Comma-separated list of scopes")
    auth_cfg.add_argument("--issuer", default=None, help="OIDC issuer URL (for generic OIDC provider only)")

    auth_test = auth_sso_sub.add_parser("test", help="Generate authorization URL for manual testing")
    auth_test.add_argument("provider", choices=["google", "github", "microsoft", "oidc"], help="Provider name")

    # --- replay subcommand (F102: deterministic trace replay) ---
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


    # --- plugin subcommand (F92: pip-installable extensions) ---
    pl = sub.add_parser("plugin", help="Manage GraphCaster plugins (F92)")
    pl_sub = pl.add_subparsers(dest="plugin_command", required=True)

    pl_list = pl_sub.add_parser("list", help="List installed (entry-points) and local plugins")
    pl_list.add_argument("--search-dir", dest="search_dirs", action="append", type=Path, default=None, metavar="DIR")

    pl_load = pl_sub.add_parser("load", help="Load a plugin and register its contributions")
    pl_load.add_argument("name", help="Plugin name")
    pl_load.add_argument("--search-dir", dest="search_dirs", action="append", type=Path, default=None, metavar="DIR")
    pl_load.add_argument("--auto-trust", action="store_true", dest="auto_trust")

    pl_unload = pl_sub.add_parser("unload", help="Unload a plugin")
    pl_unload.add_argument("name")

    pl_info = pl_sub.add_parser("info", help="Print manifest JSON (without loading)")
    pl_info.add_argument("name")
    pl_info.add_argument("--search-dir", dest="search_dirs", action="append", type=Path, default=None, metavar="DIR")

    pl_trust = pl_sub.add_parser("trust", help="Grant permissions in trust file")
    pl_trust.add_argument("name")
    pl_trust.add_argument("--allow", required=True, metavar="PERMS")
    pl_trust.add_argument("--version", default="")
    pl_trust.add_argument("--search-dir", dest="search_dirs", action="append", type=Path, default=None, metavar="DIR")

    pl_untrust = pl_sub.add_parser("untrust", help="Remove from trust file")
    pl_untrust.add_argument("name")

    pl_watch = pl_sub.add_parser(
        "watch",
        help="Hot-reload: watch plugin source dirs for changes (requires GC_DEV=1)",
    )
    pl_watch.add_argument(
        "--search-dir",
        dest="search_dirs",
        action="append",
        type=Path,
        default=None,
        metavar="DIR",
        help="Plugin search directory (repeatable); defaults to standard search dirs",
    )
    pl_watch.add_argument(
        "--poll-interval",
        dest="poll_interval",
        type=float,
        default=1.0,
        metavar="SEC",
        help="Poll interval in seconds (default: 1.0)",
    )

    pl_new = pl_sub.add_parser("new", help="Scaffold a new plugin skeleton (F96)")
    pl_new.add_argument("name", help="Plugin name (e.g. my-plugin)")
    pl_new.add_argument("--author", default="", help="Author name")
    pl_new.add_argument("--description", default="", help="Short description")
    pl_new.add_argument(
        "--allow",
        default="",
        metavar="PERMS",
        help="Comma-separated permissions to pre-declare (storage,network,subprocess,secrets,model_calls)",
    )
    pl_new.add_argument(
        "--template",
        default="node",
        choices=["minimal", "node", "tool", "provider"],
        help="Scaffold template (default: node)",
    )
    pl_new.add_argument(
        "--dir",
        dest="target_dir",
        type=Path,
        default=Path("."),
        metavar="DIR",
        help="Parent directory to create the plugin in (default: current directory)",
    )

    pl_publish = pl_sub.add_parser("publish", help="Publish a plugin to a registry (F96)")
    pl_publish.add_argument("name", help="Plugin name to publish")

    # --- rbac subcommand (F84: role-based access control) ---
    rb = sub.add_parser("rbac", help="RBAC utilities: roles, scopes, permission checks")
    rb_sub = rb.add_subparsers(dest="rbac_command", required=True)

    rb_sub.add_parser("roles", help="List all roles and their assigned scopes")
    rb_sub.add_parser("scopes", help="List all known scopes across all roles")

    rb_check = rb_sub.add_parser("check", help="Check whether a user (by role) has a given scope")
    rb_check.add_argument("--user", required=True, help="User identifier (used for display only)")
    rb_check.add_argument("--role", required=True,
                          choices=["owner", "admin", "editor", "viewer", "dataset_operator"],
                          help="Role to evaluate")
    rb_check.add_argument("--scope", required=True, help="Scope to check, e.g. graph:edit")

    cl = sub.add_parser("collab", help="Collab CRDT utilities (F77)")
    cl_sub = cl.add_subparsers(dest="collab_command", required=True)
    cl_dump = cl_sub.add_parser("dump", help="Print size of .collab.bin state for a graph")
    cl_dump.add_argument("graph_id", help="Graph ID to inspect")
    cl_dump.add_argument("--graphs-dir", type=Path, default=None, help="Directory of graph files")

    reg_cmd = sub.add_parser("registry", help="Plugin registry client (PyPI + GitHub manifests, F97)")
    reg_sub = reg_cmd.add_subparsers(dest="registry_command", required=True)

    reg_search = reg_sub.add_parser("search", help="Search available plugins")
    reg_search.add_argument("query", nargs="?", default="", help="Search query (optional)")
    reg_search.add_argument("--limit", type=int, default=50, help="Max results (default 50)")

    reg_info = reg_sub.add_parser("info", help="Show details for a plugin")
    reg_info.add_argument("name", help="Plugin package name")

    reg_install = reg_sub.add_parser("install", help="Install a plugin from registry")
    reg_install.add_argument("name", help="Plugin package name")
    reg_install.add_argument("--version", default=None, help="Pin to a specific version")
    reg_install.add_argument("--allow-untrusted", action="store_true", dest="allow_untrusted",
                             help="Skip trust check")

    reg_uninstall = reg_sub.add_parser("uninstall", help="Uninstall a plugin")
    reg_uninstall.add_argument("name", help="Plugin package name")

    reg_sub.add_parser("list", help="List installed plugins (entry_points graphcaster.plugins)")

    reg_trust = reg_sub.add_parser("trust", help="Add plugin to registry trust list")
    reg_trust.add_argument("name", help="Plugin package name")

    reg_untrust = reg_sub.add_parser("untrust", help="Remove plugin from registry trust list")
    reg_untrust.add_argument("name", help="Plugin package name")

    # --- share subcommand (F86: public sharing links) ---
    sh = sub.add_parser("share", help="Manage public sharing links for graphs (F86)")
    sh_sub = sh.add_subparsers(dest="share_command", required=True)

    sh_create = sh_sub.add_parser("create", help="Create a public sharing link for a graph")
    sh_create.add_argument("graph_id", help="Graph ID to share")
    sh_create.add_argument(
        "--permissions",
        default="view-and-run",
        choices=["view", "run", "view-and-run"],
        help="Permissions granted by this link (default: view-and-run)",
    )
    sh_create.add_argument(
        "--version",
        type=int,
        default=None,
        help="Pin to a specific published version (default: current draft)",
    )
    sh_create.add_argument(
        "--expires",
        dest="expires_at",
        default=None,
        metavar="ISO_DATE",
        help="Expiry date in ISO format, e.g. 2026-12-31 (optional)",
    )
    sh_create.add_argument(
        "--max-uses",
        type=int,
        default=None,
        dest="max_uses",
        help="Maximum number of times this link may be used (optional, default unlimited)",
    )
    sh_create.add_argument(
        "--workspace",
        type=Path,
        default=Path("."),
        help="Workspace root (default: current directory)",
    )

    sh_list = sh_sub.add_parser("list", help="List sharing links in the workspace")
    sh_list.add_argument(
        "--workspace",
        type=Path,
        default=Path("."),
        help="Workspace root (default: current directory)",
    )
    sh_list.add_argument(
        "--graph",
        dest="graph_id",
        default=None,
        help="Filter by graph ID (optional)",
    )

    sh_revoke = sh_sub.add_parser("revoke", help="Revoke a sharing link by its ID")
    sh_revoke.add_argument("link_id", help="Share link ID to revoke")
    sh_revoke.add_argument(
        "--workspace",
        type=Path,
        default=Path("."),
        help="Workspace root (default: current directory)",
    )

    # --- resume subcommand (F45: Human-In-The-Loop pause/resume) ---
    res = sub.add_parser(
        "resume",
        help="Resume a paused run (human_input node) with a provided payload",
    )
    res.add_argument("run_id", help="Run ID of the paused run")
    res.add_argument("--node", required=True, dest="node_id", help="Node ID of the paused human_input node")
    res.add_argument(
        "--payload",
        default="null",
        help="JSON-encoded human response payload (default: null)",
    )
    res.add_argument(
        "--responded-by",
        default="",
        dest="responded_by",
        help="Identifier of the responder (optional)",
    )
    res.add_argument(
        "--workspace",
        type=Path,
        default=None,
        help="Workspace root / artifacts base (parent of runs/)",
    )
    res.add_argument(
        "--graphs-dir",
        "-g",
        type=Path,
        default=None,
        help="Directory of *.json graphs for graph document lookup",
    )

    return parser


def _merge_context_json(ctx: dict, path: Path) -> None:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("context-json root must be a JSON object")
    outs = raw.get("node_outputs")
    if isinstance(outs, dict):
        bucket = ctx.setdefault("node_outputs", {})
        bucket.update(copy.deepcopy(outs))
    for k in NESTED_CONTEXT_INPUT_KEYS:
        if k == "node_outputs":
            continue
        if k in raw:
            ctx[k] = copy.deepcopy(raw[k])


def _cmd_run(args: argparse.Namespace) -> int:
    raw = json.loads(args.document.read_text(encoding="utf-8"))
    try:
        doc = GraphDocument.from_dict(raw)
    except ValueError as e:
        print(str(e), file=sys.stderr)
        return 2

    graphs_root = Path(args.graphs_dir) if args.graphs_dir is not None else None
    if graphs_root is not None:
        from graph_caster.graph_ref_workspace import (
            build_workspace_graph_ref_adjacency,
            find_workspace_graph_ref_cycle,
        )
        from graph_caster.workspace import WorkspaceIndexError

        try:
            adj = build_workspace_graph_ref_adjacency(graphs_root)
        except WorkspaceIndexError as e:
            print(str(e), file=sys.stderr)
            return 2
        cyc = find_workspace_graph_ref_cycle(adj)
        if cyc:
            if len(cyc) == 1:
                chain = f"{cyc[0]} -> {cyc[0]}"
            else:
                chain = " -> ".join(cyc + [cyc[0]])
            print(f"graph-caster: graph_ref dependency cycle in workspace: {chain}", file=sys.stderr)
            return 3

    public_stream = bool(args.public_stream) or (
        (os.environ.get("GC_PUBLIC_RUN_STREAM") or "").strip().lower() in ("1", "true", "yes", "on")
    )
    sink_inner = NdjsonStdoutSink(sys.stdout.write, sys.stdout.flush)
    sink = (
        NodeExecutePublicStreamSink(sink_inner, omit_node_execute_payload=True)
        if public_stream
        else sink_inner
    )

    artifacts_base = Path(args.artifacts_base) if args.artifacts_base is not None else None
    workspace_root = Path(args.workspace_root).resolve() if args.workspace_root is not None else None
    host = RunHostContext(
        graphs_root=graphs_root,
        artifacts_base=artifacts_base,
        workspace_root=workspace_root,
    )
    reg = get_default_run_registry() if args.track_session else None
    if args.control_stdin:
        if reg is None:
            print("graph-caster run: --control-stdin requires --track-session", file=sys.stderr)
            return 2
        _spawn_stdin_cancel_loop(reg)

    until = args.until_node.strip() if args.until_node and str(args.until_node).strip() else None
    if until is not None:
        ids = {n.id for n in doc.nodes}
        if until not in ids:
            print(f"graph-caster: --until-node {until!r} is not a node id in the document", file=sys.stderr)
            return 2

    if args.step_cache and args.artifacts_base is None:
        print("graph-caster run: --step-cache requires --artifacts-base", file=sys.stderr)
        return 2

    from graph_caster.node_output_cache import StepCachePolicy

    dirty_csv = str(args.step_cache_dirty or "").strip()
    dirty_nodes = frozenset(p.strip() for p in dirty_csv.split(",") if p.strip())
    if args.step_cache:
        from graph_caster.cache_strategies import strategy_from_name

        lru_max = max(1, int(args.step_cache_lru_max or 1024))
        _strategy = strategy_from_name(
            str(args.step_cache_strategy or "id"),
            lru_max=lru_max,
        )
        step_cache_pol = StepCachePolicy(
            enabled=True,
            dirty_nodes=dirty_nodes,
            cache_strategy=_strategy,
        )
    else:
        step_cache_pol = None

    stop_after = until
    persist_ev = artifacts_base is not None and not bool(args.no_persist_run_events)
    runner = GraphRunner(
        doc,
        sink=sink,
        host=host,
        session_registry=reg,
        stop_after_node_id=stop_after,
        step_cache=step_cache_pol,
        persist_run_events=persist_ev,
        fork_max_parallel=args.fork_max_parallel,
        public_stream=public_stream,
        scheduler=getattr(args, "scheduler", None),
    )
    # F48: parse --pin-output overrides (nodeId:key:jsonValue)
    pin_overrides: dict[str, dict] = {}
    for po in (args.pin_outputs or []):
        parts = po.split(":", 2)
        if len(parts) != 3:
            print(
                f"graph-caster: --pin-output {po!r}: expected format nodeId:key:jsonValue",
                file=sys.stderr,
            )
            return 2
        po_node, po_key, po_raw = parts
        po_node, po_key = po_node.strip(), po_key.strip()
        if not po_node or not po_key:
            print(
                f"graph-caster: --pin-output {po!r}: nodeId and key must not be empty",
                file=sys.stderr,
            )
            return 2
        try:
            po_val = json.loads(po_raw)
        except json.JSONDecodeError:
            po_val = po_raw
        pin_overrides.setdefault(po_node, {})[po_key] = po_val

    try:
        ctx: dict = {"last_result": True}
        if args.run_id is not None and str(args.run_id).strip():
            ctx["run_id"] = str(args.run_id).strip()
        if args.context_json is not None:
            try:
                _merge_context_json(ctx, Path(args.context_json))
            except (OSError, json.JSONDecodeError, ValueError) as e:
                print(f"graph-caster: context-json: {e}", file=sys.stderr)
                return 2

        # F48: build pinned context for --start with --use-pins / --pins-from-run / --pin-output
        use_pins_flag = bool(getattr(args, "use_pins", False))
        pins_from_run = (getattr(args, "pins_from_run", None) or "").strip() or None
        has_f48 = (use_pins_flag or pins_from_run or pin_overrides) and args.start and until is None
        if has_f48:
            import asyncio as _asyncio
            from graph_caster.partial_exec import build_pinned_context

            _ws = workspace_root or artifacts_base or Path(".")
            _pctx = _asyncio.run(
                build_pinned_context(
                    graph=raw,
                    start_node=args.start,
                    use_pins=use_pins_flag,
                    from_run_id=pins_from_run,
                    workspace_root=_ws,
                    overrides=pin_overrides or None,
                )
            )
            bucket = ctx.setdefault("node_outputs", {})
            bucket.update(_pctx.get("node_outputs", {}))
        elif pin_overrides and not args.start:
            print(
                "graph-caster: --pin-output requires --start (mid-graph entry point)",
                file=sys.stderr,
            )
            return 2

        if until is not None and args.start:
            print(
                "graph-caster: note: --until-node runs from the document start; ignoring --start",
                file=sys.stderr,
            )

        try:
            if args.start and until is None:
                try:
                    canon = validate_graph_structure(doc)
                except GraphStructureError:
                    canon = ""
                if canon and args.start != canon and args.context_json is None:
                    print(
                        "graph-caster: warning: mid-graph --start without --context-json "
                        "may break edge conditions; prefer --context-json with node_outputs.",
                        file=sys.stderr,
                    )
                runner.run_from(args.start, context=ctx)
            elif until is not None:
                runner.run(context=ctx)
            else:
                runner.run(context=ctx)
        finally:
            if args.nested_context_out is not None:
                try:
                    write_nested_run_result_json(ctx, Path(args.nested_context_out))
                except OSError:
                    pass
    except GraphStructureError as e:
        print(str(e), file=sys.stderr)
        return 2
    return 0


def _cmd_artifacts_size(args: argparse.Namespace) -> int:
    from graph_caster.artifacts import artifacts_runs_total_bytes, artifacts_tree_bytes_for_graph

    base = Path(args.base).resolve()
    try:
        if args.graph_id:
            print(artifacts_tree_bytes_for_graph(base, args.graph_id))
        else:
            print(artifacts_runs_total_bytes(base))
    except ValueError as e:
        print(str(e), file=sys.stderr)
        return 2
    return 0


def _cmd_artifacts_clear(args: argparse.Namespace) -> int:
    from graph_caster.artifacts import clear_all_artifact_runs, clear_artifacts_for_graph

    base = Path(args.base).resolve()
    try:
        if args.all:
            clear_all_artifact_runs(base)
        else:
            gid = args.graph_id
            if not gid:
                print("artifacts-clear: --graph-id required unless --all", file=sys.stderr)
                return 2
            clear_artifacts_for_graph(base, gid)
    except ValueError as e:
        print(str(e), file=sys.stderr)
        return 2
    return 0


def _cmd_catalog_rebuild(args: argparse.Namespace) -> int:
    from graph_caster.run_catalog import rebuild_catalog_from_disk

    n = rebuild_catalog_from_disk(Path(args.artifacts_base))
    print(n)
    return 0


def _cmd_mcp_oauth(args: argparse.Namespace) -> int:
    if args.oauth_cmd != "github-device":
        print("graph-caster mcp-oauth: unknown subcommand", file=sys.stderr)
        return 2
    cid = (args.client_id or os.environ.get("GITHUB_OAUTH_CLIENT_ID", "")).strip()
    if not cid:
        print(
            "graph-caster mcp-oauth github-device: set --client-id or GITHUB_OAUTH_CLIENT_ID",
            file=sys.stderr,
        )
        return 2
    from graph_caster.mcp_oauth import GithubDeviceFlowError, run_github_device_flow

    try:
        token = run_github_device_flow(client_id=cid, scope=str(args.scope or ""))
    except GithubDeviceFlowError as e:
        print(f"graph-caster: {e}", file=sys.stderr)
        return 2
    print(token, flush=True)
    return 0


def _cmd_mcp(args: argparse.Namespace) -> int:
    try:
        import mcp  # noqa: F401
    except ImportError:
        print(
            "graph-caster mcp: install optional extra: pip install -e '.[mcp]'",
            file=sys.stderr,
        )
        return 2
    from graph_caster.mcp_server.server import host_from_cli, run_stdio

    host = host_from_cli(
        Path(args.graphs_dir),
        Path(args.workspace_root) if args.workspace_root is not None else None,
        Path(args.artifacts_base) if args.artifacts_base is not None else None,
    )
    per_graph = bool(getattr(args, "per_graph_tools", False))
    watch = bool(getattr(args, "watch", False))
    run_stdio(host, per_graph_tools=per_graph, watch=watch)
    return 0


def _cmd_export_mcp(args: argparse.Namespace) -> int:
    try:
        import mcp  # noqa: F401
    except ImportError:
        print(
            "graph-caster export-mcp: install optional extra: pip install -e '.[mcp]'",
            file=sys.stderr,
        )
        return 2
    from graph_caster.mcp_server.server import host_from_cli
    from graph_caster.mcp_server.per_graph_tools import build_single_graph_fastmcp

    host = host_from_cli(
        Path(args.graphs_dir),
        Path(args.workspace_root) if args.workspace_root is not None else None,
        Path(args.artifacts_base) if args.artifacts_base is not None else None,
    )
    try:
        app = build_single_graph_fastmcp(host, args.graph_id)
    except ValueError as e:
        print(f"graph-caster export-mcp: {e}", file=sys.stderr)
        return 2

    bind = str(getattr(args, "bind", "stdio") or "stdio").strip().lower()
    if bind == "http":
        port = int(getattr(args, "port", 8765) or 8765)
        app.run(transport="streamable-http", host="127.0.0.1", port=port)
    else:
        app.run(transport="stdio")
    return 0


def _cmd_worker(args: argparse.Namespace) -> int:
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


def _cmd_serve(args: argparse.Namespace) -> int:
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


def _cmd_kb(args: argparse.Namespace) -> int:
    import asyncio

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


def _parse_scope_key(ref: str) -> tuple[str, str]:
    """Split 'scope.name' into (scope, name). Raises ValueError on bad format."""
    parts = ref.split(".", 1)
    if len(parts) != 2 or not parts[0] or not parts[1]:
        raise ValueError(f"Variable reference must be scope.name, got: {ref!r}")
    return parts[0], parts[1]


def _cmd_vars(args: argparse.Namespace) -> int:
    import asyncio

    from graph_caster.variables import FileVariableStore, VariableContext, VariableScope

    workspace = Path(args.workspace).resolve()
    store_root = workspace / ".graphcaster" / "vars"
    tenant_id = str(args.tenant or "default")
    store = FileVariableStore(store_root, tenant_id=tenant_id)

    ctx = VariableContext(
        store,
        run_id="cli",
        session_id=None,
        tenant_id=tenant_id,
    )

    if args.vars_command == "set":
        try:
            scope_str, var_name = _parse_scope_key(args.key)
        except ValueError as e:
            print(str(e), file=sys.stderr)
            return 2
        try:
            scope = VariableScope(scope_str)
        except ValueError:
            print(f"vars set: unknown scope {scope_str!r}", file=sys.stderr)
            return 2
        raw_val: str = args.value
        try:
            value: object = json.loads(raw_val)
        except json.JSONDecodeError:
            value = raw_val
        try:
            asyncio.run(ctx.set(scope, var_name, value))
        except ValueError as e:
            print(str(e), file=sys.stderr)
            return 2
        print(json.dumps({"scope": scope_str, "key": var_name, "value": value}, ensure_ascii=False))
        return 0

    if args.vars_command == "get":
        try:
            scope_str, var_name = _parse_scope_key(args.key)
        except ValueError as e:
            print(str(e), file=sys.stderr)
            return 2
        try:
            scope = VariableScope(scope_str)
        except ValueError:
            print(f"vars get: unknown scope {scope_str!r}", file=sys.stderr)
            return 2
        value = asyncio.run(ctx.get(scope, var_name))
        if value is None:
            print(f"vars get: {args.key} not found", file=sys.stderr)
            return 1
        print(json.dumps(value, ensure_ascii=False))
        return 0

    if args.vars_command == "list":
        try:
            scope = VariableScope(args.scope)
        except ValueError:
            print(f"vars list: unknown scope {args.scope!r}", file=sys.stderr)
            return 2
        data = asyncio.run(ctx.list_scope(scope))
        print(json.dumps(data, ensure_ascii=False, indent=2))
        return 0

    if args.vars_command == "delete":
        try:
            scope_str, var_name = _parse_scope_key(args.key)
        except ValueError as e:
            print(str(e), file=sys.stderr)
            return 2
        try:
            scope = VariableScope(scope_str)
        except ValueError:
            print(f"vars delete: unknown scope {scope_str!r}", file=sys.stderr)
            return 2
        try:
            asyncio.run(ctx.delete(scope, var_name))
        except ValueError as e:
            print(str(e), file=sys.stderr)
            return 2
        print(json.dumps({"deleted": args.key}, ensure_ascii=False))
        return 0

    return 2


def _cmd_composio(args: argparse.Namespace) -> int:
    import asyncio

    try:
        from graph_caster.tools.composio.bridge import ComposioBridge
    except ImportError as exc:
        print(f"graph-caster composio: {exc}", file=sys.stderr)
        return 2

    workspace = Path(args.workspace).resolve() if getattr(args, "workspace", None) is not None else None
    bridge = ComposioBridge(workspace_root=workspace)

    if args.composio_command == "list-apps":
        try:
            apps = asyncio.run(bridge.list_apps())
        except ImportError as exc:
            print(str(exc), file=sys.stderr)
            return 2
        except Exception as exc:
            print(f"graph-caster composio list-apps: {exc}", file=sys.stderr)
            return 2
        print(json.dumps(apps, ensure_ascii=False, indent=2))
        return 0

    if args.composio_command == "list-actions":
        app_filter: str | None = getattr(args, "app", None)
        try:
            actions = asyncio.run(bridge.list_actions(app=app_filter))
        except ImportError as exc:
            print(str(exc), file=sys.stderr)
            return 2
        except Exception as exc:
            print(f"graph-caster composio list-actions: {exc}", file=sys.stderr)
            return 2
        print(
            json.dumps(
                [
                    {
                        "name": a.name,
                        "app": a.app,
                        "display_name": a.display_name,
                        "description": a.description,
                    }
                    for a in actions
                ],
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0

    if args.composio_command == "schema":
        try:
            schema = asyncio.run(bridge.get_action_schema(args.action))
        except ImportError as exc:
            print(str(exc), file=sys.stderr)
            return 2
        except Exception as exc:
            print(f"graph-caster composio schema: {exc}", file=sys.stderr)
            return 2
        print(json.dumps(schema, ensure_ascii=False, indent=2))
        return 0

    if args.composio_command == "invoke":
        try:
            params = json.loads(args.params)
        except json.JSONDecodeError as exc:
            print(f"graph-caster composio invoke: invalid --params JSON: {exc}", file=sys.stderr)
            return 2
        entity_id = str(args.entity_id or "default")
        try:
            result = asyncio.run(bridge.invoke(args.action, params, entity_id=entity_id))
        except ImportError as exc:
            print(str(exc), file=sys.stderr)
            return 2
        except Exception as exc:
            print(f"graph-caster composio invoke: {exc}", file=sys.stderr)
            return 2
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    return 2


def _cmd_export_dataset(args: argparse.Namespace) -> int:
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


def _parse_version_arg(raw: str) -> int | None:
    """Convert 'draft' or an integer string to int | None."""
    if raw.strip().lower() == "draft":
        return None
    try:
        return int(raw)
    except ValueError:
        raise ValueError(f"version must be an integer or 'draft', got: {raw!r}")


def _cmd_publish(args: argparse.Namespace) -> int:
    import asyncio

    from graph_caster.versioning import VersionManager

    workspace = Path(args.workspace).resolve()
    mgr = VersionManager(workspace)
    try:
        ver = asyncio.run(mgr.publish(args.graph_id, author=str(args.author or ""), message=str(args.message or "")))
    except FileNotFoundError as e:
        print(str(e), file=sys.stderr)
        return 2
    print(json.dumps(ver.to_dict(), ensure_ascii=False, indent=2))
    return 0


def _cmd_versions(args: argparse.Namespace) -> int:
    import asyncio

    from graph_caster.versioning import VersionManager

    workspace = Path(args.workspace).resolve()
    mgr = VersionManager(workspace)

    if args.versions_command == "list":
        versions = asyncio.run(mgr.list_versions(args.graph_id))
        print(json.dumps([v.to_dict() for v in versions], ensure_ascii=False, indent=2))
        return 0

    if args.versions_command == "show":
        try:
            ver = asyncio.run(mgr.get_version(args.graph_id, args.version))
        except KeyError as e:
            print(str(e), file=sys.stderr)
            return 2
        try:
            doc = asyncio.run(mgr.load_graph(args.graph_id, args.version))
        except (FileNotFoundError, KeyError) as e:
            print(str(e), file=sys.stderr)
            return 2
        print(json.dumps({"version": ver.to_dict(), "document": doc}, ensure_ascii=False, indent=2))
        return 0

    if args.versions_command == "diff":
        try:
            v_a = _parse_version_arg(str(args.a))
            v_b = _parse_version_arg(str(args.b))
        except ValueError as e:
            print(str(e), file=sys.stderr)
            return 2
        try:
            result = asyncio.run(mgr.diff(args.graph_id, v_a, v_b))
        except (FileNotFoundError, KeyError) as e:
            print(str(e), file=sys.stderr)
            return 2
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0

    return 2


def _cmd_rollback(args: argparse.Namespace) -> int:
    import asyncio

    from graph_caster.versioning import VersionManager

    workspace = Path(args.workspace).resolve()
    mgr = VersionManager(workspace)
    try:
        asyncio.run(mgr.rollback_draft_to(args.graph_id, args.version))
    except (KeyError, FileNotFoundError) as e:
        print(str(e), file=sys.stderr)
        return 2
    print(json.dumps({"rolledBack": True, "graphId": args.graph_id, "version": args.version}, ensure_ascii=False))
    return 0


def _cmd_rag(args: argparse.Namespace) -> int:
    import asyncio

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


def _cmd_tools(args: argparse.Namespace) -> int:
    import asyncio as _asyncio

    from graph_caster.tools.registry import get_default_registry

    registry = get_default_registry()

    if args.tools_command == "list":
        tools = registry.list()
        rows = [
            {"name": s.name, "display_name": s.display_name, "description": s.description}
            for s in tools
        ]
        print(json.dumps(rows, ensure_ascii=False, indent=2))
        return 0

    if args.tools_command == "show":
        spec = registry.get(args.tool_name)
        if spec is None:
            available = [s.name for s in registry.list()]
            print(
                f"tools show: unknown tool {args.tool_name!r}. Available: {available}",
                file=sys.stderr,
            )
            return 1
        out = {
            "name": spec.name,
            "display_name": spec.display_name,
            "description": spec.description,
            "parameters": spec.parameters,
        }
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return 0

    if args.tools_command == "invoke":
        spec = registry.get(args.tool_name)
        if spec is None:
            available = [s.name for s in registry.list()]
            print(
                f"tools invoke: unknown tool {args.tool_name!r}. Available: {available}",
                file=sys.stderr,
            )
            return 1
        try:
            tool_args = json.loads(args.args)
        except json.JSONDecodeError as exc:
            print(f"tools invoke: invalid --args JSON: {exc}", file=sys.stderr)
            return 2
        if not isinstance(tool_args, dict):
            print("tools invoke: --args must be a JSON object", file=sys.stderr)
            return 2
        try:
            result = _asyncio.run(spec.callable(**tool_args))
        except Exception as exc:
            print(f"tools invoke: {exc}", file=sys.stderr)
            return 2
        try:
            print(json.dumps(result, ensure_ascii=False, indent=2, default=lambda o: repr(o)))
        except Exception:
            print(repr(result))
        return 0

    return 2


def _cmd_openapi(args: argparse.Namespace) -> int:
    import asyncio as _asyncio
    from graph_caster.tools.openapi_import import OpenAPIImporter, invoke_openapi_tool

    importer = OpenAPIImporter()
    spec_source: str = args.spec
    base_url_override: str | None = getattr(args, "base_url", None)

    async def _load():
        if spec_source.startswith("http://") or spec_source.startswith("https://"):
            return await importer.from_url(spec_source)
        from pathlib import Path as _Path
        return importer.from_file(_Path(spec_source))

    try:
        specs = _asyncio.run(_load())
    except Exception as exc:
        print(f"graph-caster openapi: failed to load spec: {exc}", file=sys.stderr)
        return 2

    if base_url_override:
        from graph_caster.tools.openapi_import import OpenAPIToolSpec, AuthSpec
        specs = [
            OpenAPIToolSpec(
                name=s.name, summary=s.summary, description=s.description,
                method=s.method, path=s.path, base_url=base_url_override.rstrip("/"),
                parameters=s.parameters, request_body=s.request_body,
                response_schema=s.response_schema, auth=s.auth,
                raw_operation=s.raw_operation,
            )
            for s in specs
        ]

    cmd = str(getattr(args, "openapi_command", ""))

    if cmd == "inspect":
        out = [
            {
                "name": s.name,
                "method": s.method,
                "path": s.path,
                "base_url": s.base_url,
                "summary": s.summary,
                "auth_kind": s.auth.kind,
                "parameters": [p.get("name") for p in s.parameters],
            }
            for s in specs
        ]
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return 0

    if cmd == "list-operations":
        for s in specs:
            print(f"{s.name}  {s.method}  {s.path}")
        return 0

    if cmd == "invoke":
        op_id: str = str(getattr(args, "operation_id", "")).strip()
        args_json: str = str(getattr(args, "args_json", "{}") or "{}")
        timeout_sec: float = float(getattr(args, "timeout_sec", 30.0) or 30.0)

        try:
            invoke_args = json.loads(args_json)
        except json.JSONDecodeError as exc:
            print(f"graph-caster openapi invoke: invalid --args JSON: {exc}", file=sys.stderr)
            return 2

        from graph_caster.tools.openapi_import import _sanitize_name
        target = _sanitize_name(op_id)
        op_spec = next(
            (s for s in specs if s.name == target or s.raw_operation.get("operationId") == op_id),
            None,
        )
        if op_spec is None:
            available = [s.name for s in specs]
            print(
                f"graph-caster openapi invoke: operationId {op_id!r} not found. Available: {available}",
                file=sys.stderr,
            )
            return 2

        async def _invoke():
            return await invoke_openapi_tool(op_spec, invoke_args, secrets_resolver=None, timeout_sec=timeout_sec)

        try:
            result = _asyncio.run(_invoke())
        except Exception as exc:
            print(f"graph-caster openapi invoke: {exc}", file=sys.stderr)
            return 2

        print(json.dumps(result, ensure_ascii=False, indent=2, default=str))
        return 0

    return 2


def _cmd_rbac(args: argparse.Namespace) -> int:
    from graph_caster.auth.rbac import ROLE_SCOPES, Role, has_scope, scopes_for_role

    if args.rbac_command == "roles":
        for role in Role:
            scopes = sorted(ROLE_SCOPES[role])
            print(f"{role.value}:")
            for s in scopes:
                print(f"  {s}")
        return 0

    if args.rbac_command == "scopes":
        all_scopes: set[str] = set()
        for scopes in ROLE_SCOPES.values():
            all_scopes.update(scopes)
        for s in sorted(all_scopes):
            print(s)
        return 0

    if args.rbac_command == "check":
        try:
            role = Role(args.role)
        except ValueError:
            print(f"rbac check: unknown role {args.role!r}", file=sys.stderr)
            return 2
        effective = scopes_for_role(role)
        granted = has_scope(effective, args.scope)
        status = "GRANTED" if granted else "DENIED"
        print(
            json.dumps(
                {
                    "user": args.user,
                    "role": role.value,
                    "scope": args.scope,
                    "result": status,
                    "effective_scopes": sorted(effective),
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0 if granted else 1

    return 2


def _cmd_audit(args: argparse.Namespace) -> int:
    import asyncio as _asyncio

    from graph_caster.audit.audit_query import AuditQuery, verify_chain
    import os as _os

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








def _cmd_ai_build(args: argparse.Namespace) -> int:
    import asyncio as _asyncio_aib

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


def _cmd_ai_refine(args: argparse.Namespace) -> int:
    import asyncio as _asyncio_air

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


def _cmd_auth(args: argparse.Namespace) -> int:
    import asyncio as _asyncio_auth

    _oauth_config_path = Path.home() / ".graphcaster" / "oauth.json"

    def _load_oauth_configs() -> dict:
        if not _oauth_config_path.exists():
            return {}
        try:
            return json.loads(_oauth_config_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}

    def _save_oauth_configs(cfgs: dict) -> None:
        _oauth_config_path.parent.mkdir(parents=True, exist_ok=True)
        _oauth_config_path.write_text(json.dumps(cfgs, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    if args.auth_command != "sso":
        print("auth: unknown subcommand", file=sys.stderr)
        return 2

    sso_cmd = args.sso_command

    if sso_cmd == "providers":
        cfgs = _load_oauth_configs()
        env_providers = []
        for pname in ("google", "github", "microsoft", "oidc"):
            prefix = f"GC_OAUTH_{pname.upper()}"
            cid = os.environ.get(f"{prefix}_CLIENT_ID", "").strip()
            if cid:
                env_providers.append({"provider": pname, "source": "env", "client_id": cid})
        file_providers = [
            {"provider": k, "source": "file", "client_id": v.get("client_id", "")}
            for k, v in cfgs.items()
        ]
        providers = env_providers + file_providers
        if not providers:
            print("No SSO providers configured.")
            print("Set GC_OAUTH_<PROVIDER>_CLIENT_ID / _CLIENT_SECRET / _REDIRECT_URI env vars,")
            print("or run: python -m graph_caster auth sso configure <provider> --client-id ... --client-secret ... --redirect-uri ...")
        else:
            print(json.dumps(providers, indent=2, ensure_ascii=False))
        return 0

    if sso_cmd == "configure":
        provider = args.provider
        scopes_raw = str(args.scopes or "").strip()
        scopes = [s.strip() for s in scopes_raw.split(",") if s.strip()]
        cfg: dict = {
            "client_id": args.client_id,
            "client_secret": args.client_secret,
            "redirect_uri": args.redirect_uri,
            "scopes": scopes,
        }
        if args.issuer:
            cfg["issuer"] = args.issuer
        cfgs = _load_oauth_configs()
        cfgs[provider] = cfg
        _save_oauth_configs(cfgs)
        print(f"auth sso configure: saved {provider} config to {_oauth_config_path}")
        return 0

    if sso_cmd == "test":
        provider = args.provider
        from graph_caster.auth.oauth.base import OAuthConfig
        from graph_caster.auth.oauth.flow import OAuthFlow
        from graph_caster.auth.oauth.state_store import InMemoryStateStore

        cfgs = _load_oauth_configs()
        file_cfg = cfgs.get(provider, {})
        prefix = f"GC_OAUTH_{provider.upper()}"
        client_id = os.environ.get(f"{prefix}_CLIENT_ID", "").strip() or file_cfg.get("client_id", "")
        client_secret = os.environ.get(f"{prefix}_CLIENT_SECRET", "").strip() or file_cfg.get("client_secret", "")
        redirect_uri = os.environ.get(f"{prefix}_REDIRECT_URI", "").strip() or file_cfg.get("redirect_uri", "")

        if not client_id or not client_secret:
            print(f"auth sso test: {provider} not configured (no client_id/client_secret)", file=sys.stderr)
            return 2

        scopes_raw = os.environ.get(f"{prefix}_SCOPES", "").strip()
        scopes = [s.strip() for s in scopes_raw.split(",") if s.strip()] if scopes_raw else file_cfg.get("scopes", [])

        oauth_config = OAuthConfig(
            client_id=client_id,
            client_secret=client_secret,
            redirect_uri=redirect_uri,
            scopes=scopes,
        )

        if provider == "google":
            from graph_caster.auth.oauth.google import GoogleOAuthProvider
            prov = GoogleOAuthProvider()
        elif provider == "github":
            from graph_caster.auth.oauth.github import GitHubOAuthProvider
            prov = GitHubOAuthProvider()
        elif provider == "microsoft":
            from graph_caster.auth.oauth.microsoft import MicrosoftOAuthProvider
            tenant = os.environ.get("GC_OAUTH_MICROSOFT_TENANT", "common").strip()
            prov = MicrosoftOAuthProvider(tenant=tenant)
        else:
            issuer = os.environ.get("GC_OIDC_ISSUER", "").strip() or file_cfg.get("issuer", "")
            if not issuer:
                print("auth sso test: GC_OIDC_ISSUER not set for generic OIDC provider", file=sys.stderr)
                return 2
            from graph_caster.auth.oauth.generic_oidc import GenericOIDCProvider
            prov = GenericOIDCProvider(issuer=issuer)

        state_store = InMemoryStateStore()
        flow = OAuthFlow(prov, oauth_config, state_store)
        auth_url, state = _asyncio_auth.run(flow.start())
        print(f"Provider   : {provider}")
        print(f"State      : {state}")
        print(f"Authorize URL:")
        print(f"  {auth_url}")
        return 0

    return 2


def _cmd_replay(args: argparse.Namespace) -> int:
    import asyncio as _asyncio_replay

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



def _cmd_plugin(args: argparse.Namespace) -> int:
    import asyncio
    from graph_caster.plugin.loader import PluginLoader
    from graph_caster.plugin.permissions import revoke_trust, write_trust

    search_dirs = [Path(d) for d in (getattr(args, "search_dirs", None) or [])]

    if args.plugin_command == "list":
        loader = PluginLoader(search_dirs=search_dirs if search_dirs else None)
        ep_names = loader.discover_entry_points()
        local_paths = loader.discover_local()
        print(json.dumps({"entry_points": ep_names, "local": [str(p) for p in local_paths]}, ensure_ascii=False, indent=2))
        return 0

    if args.plugin_command == "load":
        loader = PluginLoader(
            search_dirs=search_dirs if search_dirs else None,
            auto_trust=bool(getattr(args, "auto_trust", False)),
        )
        try:
            manifest = asyncio.run(loader.load(args.name))
        except (PermissionError, ModuleNotFoundError, ImportError, TypeError) as exc:
            print(f"graph-caster plugin load: {exc}", file=sys.stderr)
            return 2
        print(json.dumps(manifest.to_dict(), ensure_ascii=False, indent=2))
        return 0

    if args.plugin_command == "unload":
        print("graph-caster plugin unload: only meaningful in-process; use PluginLoader API.", file=sys.stderr)
        return 1

    if args.plugin_command == "info":
        loader = PluginLoader(search_dirs=search_dirs if search_dirs else None, auto_trust=True)
        try:
            manifest = asyncio.run(loader._import_manifest(args.name))
        except (ModuleNotFoundError, ImportError, TypeError) as exc:
            print(f"graph-caster plugin info: {exc}", file=sys.stderr)
            return 2
        print(manifest.to_json())
        return 0

    if args.plugin_command == "trust":
        raw_perms = [p.strip() for p in str(args.allow).split(",") if p.strip()]
        version = str(getattr(args, "version", "") or "").strip()
        if not version:
            loader = PluginLoader(search_dirs=search_dirs if search_dirs else None, auto_trust=True)
            try:
                manifest = asyncio.run(loader._import_manifest(args.name))
                version = manifest.version
            except Exception:
                version = "unknown"
        write_trust(args.name, version, frozenset(raw_perms))
        print(json.dumps({"trusted": args.name, "version": version, "permissions": raw_perms}, ensure_ascii=False))
        return 0

    if args.plugin_command == "untrust":
        revoke_trust(args.name)
        print(json.dumps({"untrusted": args.name}, ensure_ascii=False))
        return 0

    if args.plugin_command == "watch":
        import os as _os
        if not _os.environ.get("GC_DEV", "").strip():
            print(
                "graph-caster plugin watch: GC_DEV is not set. "
                "Set GC_DEV=1 to enable hot-reload.",
                file=sys.stderr,
            )
            return 1
        from graph_caster.plugin.hot_reload import HotReloadWatcher

        poll_interval = float(getattr(args, "poll_interval", 1.0))
        loader = PluginLoader(search_dirs=search_dirs if search_dirs else None)
        watcher = HotReloadWatcher(
            loader,
            search_dirs=search_dirs if search_dirs else None,
            poll_interval_sec=poll_interval,
        )

        async def _watch_forever() -> None:
            await watcher.start()
            print(
                json.dumps({"status": "watching", "poll_interval_sec": poll_interval}),
                flush=True,
            )
            try:
                while True:
                    await asyncio.sleep(3600)
            except (KeyboardInterrupt, asyncio.CancelledError):
                pass
            finally:
                await watcher.stop()

        try:
            asyncio.run(_watch_forever())
        except KeyboardInterrupt:
            pass
        return 0

    if args.plugin_command == "new":
        from graph_caster.plugin.scaffold import scaffold_plugin
        raw_perms = [p.strip() for p in str(getattr(args, "allow", "") or "").split(",") if p.strip()]
        target_dir = Path(getattr(args, "target_dir", None) or ".")
        template = getattr(args, "template", "node") or "node"
        try:
            created = scaffold_plugin(
                args.name,
                author=str(getattr(args, "author", "") or ""),
                description=str(getattr(args, "description", "") or ""),
                permissions=raw_perms,
                target_dir=target_dir,
                template=template,
            )
        except Exception as exc:
            print(f"graph-caster plugin new: {exc}", file=sys.stderr)
            return 2
        print(json.dumps({"created": str(created)}, ensure_ascii=False))
        return 0

    if args.plugin_command == "publish":
        print(
            "Plugin publish is not yet wired to a registry — "
            "build wheel with `python -m build` and publish manually.",
            file=sys.stderr,
        )
        return 1

    return 2


def _cmd_collab(args: argparse.Namespace) -> int:
    from graph_caster.run_broker.collab_ws import _bin_path

    if args.collab_command == "dump":
        graphs_dir = getattr(args, "graphs_dir", None)
        if graphs_dir is not None:
            import os as _os
            _os.environ["GC_GRAPHS_DIR"] = str(graphs_dir)
        path = _bin_path(args.graph_id)
        if path is None:
            print(
                json.dumps({"error": "GC_GRAPHS_DIR not set; cannot locate .collab.bin"}),
                file=sys.stderr,
            )
            return 1
        if not path.exists():
            print(json.dumps({"graphId": args.graph_id, "exists": False, "bytes": 0}))
            return 0
        size = path.stat().st_size
        print(
            json.dumps(
                {
                    "graphId": args.graph_id,
                    "exists": True,
                    "bytes": size,
                    "path": str(path),
                    "note": "Binary Y.Doc state; full decode is a follow-up (no Python yjs dep).",
                }
            )
        )
        return 0

    print(f"graph-caster collab: unknown subcommand {args.collab_command!r}", file=sys.stderr)
    return 2


def _cmd_registry(args: argparse.Namespace) -> int:
    import asyncio as _asyncio_reg
    from graph_caster.plugin.registry_client import (
        PluginRegistryClient,
        add_trust,
        remove_trust,
    )

    client = PluginRegistryClient()

    if args.registry_command == "search":
        query = str(getattr(args, "query", "") or "")
        limit = int(getattr(args, "limit", 50) or 50)
        results = _asyncio_reg.run(client.search(query, limit=limit))
        print(json.dumps([e.to_dict() for e in results], ensure_ascii=False, indent=2))
        return 0

    if args.registry_command == "info":
        entry = _asyncio_reg.run(client.get(args.name))
        if entry is None:
            print(f"registry info: plugin {args.name!r} not found", file=sys.stderr)
            return 1
        print(json.dumps(entry.to_dict(), ensure_ascii=False, indent=2))
        return 0

    if args.registry_command == "install":
        version = getattr(args, "version", None)
        allow_untrusted = bool(getattr(args, "allow_untrusted", False))
        try:
            _asyncio_reg.run(client.install(args.name, version=version, allow_untrusted=allow_untrusted))
        except PermissionError as exc:
            print(f"registry install: {exc}", file=sys.stderr)
            return 2
        except RuntimeError as exc:
            print(f"registry install: {exc}", file=sys.stderr)
            return 2
        print(json.dumps({"installed": args.name, "version": version}, ensure_ascii=False))
        return 0

    if args.registry_command == "uninstall":
        try:
            _asyncio_reg.run(client.uninstall(args.name))
        except RuntimeError as exc:
            print(f"registry uninstall: {exc}", file=sys.stderr)
            return 2
        print(json.dumps({"uninstalled": args.name}, ensure_ascii=False))
        return 0

    if args.registry_command == "list":
        entries = _asyncio_reg.run(client.list_installed())
        print(json.dumps([e.to_dict() for e in entries], ensure_ascii=False, indent=2))
        return 0

    if args.registry_command == "trust":
        add_trust(args.name)
        print(json.dumps({"trusted": args.name}, ensure_ascii=False))
        return 0

    if args.registry_command == "untrust":
        remove_trust(args.name)
        print(json.dumps({"untrusted": args.name}, ensure_ascii=False))
        return 0

    return 2


def main(argv: list[str] | None = None) -> int:
    if argv is None:
        argv = list(sys.argv[1:])
    if not argv:
        _build_parser().print_help()
        return 0
    argv = _normalize_argv(argv)
    parser = _build_parser()
    args = parser.parse_args(argv)
    if args.command == "run":
        return _cmd_run(args)
    if args.command == "artifacts-size":
        return _cmd_artifacts_size(args)
    if args.command == "artifacts-clear":
        return _cmd_artifacts_clear(args)
    if args.command == "catalog-rebuild":
        return _cmd_catalog_rebuild(args)
    if args.command == "serve":
        return _cmd_serve(args)
    if args.command == "worker":
        return _cmd_worker(args)
    if args.command == "mcp":
        return _cmd_mcp(args)
    if args.command == "mcp-oauth":
        return _cmd_mcp_oauth(args)
    if args.command == "export-mcp":
        return _cmd_export_mcp(args)
    if args.command == "kb":
        return _cmd_kb(args)
    if args.command == "vars":
        return _cmd_vars(args)
    if args.command == "composio":
        return _cmd_composio(args)
    if args.command == "export-dataset":
        return _cmd_export_dataset(args)
    if args.command == "rag":
        return _cmd_rag(args)
    if args.command == "publish":
        return _cmd_publish(args)
    if args.command == "versions":
        return _cmd_versions(args)
    if args.command == "rollback":
        return _cmd_rollback(args)
    if args.command == "ai-build":
        return _cmd_ai_build(args)
    if args.command == "ai-refine":
        return _cmd_ai_refine(args)
    if args.command == "tools":
        return _cmd_tools(args)
    if args.command == "openapi":
        return _cmd_openapi(args)
    if args.command == "audit":
        return _cmd_audit(args)
    if args.command == "tenant":
        return _cmd_tenant(args)
    if args.command == "user":
        return _cmd_user(args)
    if args.command == "member":
        return _cmd_member(args)
    if args.command == "auth":
        return _cmd_auth(args)
    if args.command == "replay":
        return _cmd_replay(args)
    if args.command == "plugin":
        return _cmd_plugin(args)
    if args.command == "rbac":
        return _cmd_rbac(args)
    if args.command == "collab":
        return _cmd_collab(args)
    if args.command == "registry":
        return _cmd_registry(args)
    if args.command == "share":
        return _cmd_share(args)
    if args.command == "resume":
        return _cmd_resume(args)
    return 2


def _cmd_resume(args: argparse.Namespace) -> int:
    import asyncio as _asyncio_r
    import datetime as _dt
    import subprocess as _sp

    run_id = str(args.run_id).strip()
    node_id = str(args.node_id).strip()
    responded_by = str(args.responded_by or "").strip()

    try:
        payload = json.loads(args.payload)
    except json.JSONDecodeError as exc:
        print(f"graph-caster resume: --payload is not valid JSON: {exc}", file=sys.stderr)
        return 2

    workspace = Path(args.workspace).resolve() if args.workspace else Path(".").resolve()
    graphs_dir = Path(args.graphs_dir).resolve() if args.graphs_dir else None

    from graph_caster.pause_resume import CheckpointStore as _CpStore

    store = _CpStore(workspace)

    try:
        checkpoint = _asyncio_r.run(store.load(run_id))
    except Exception as exc:
        print(f"graph-caster resume: failed to load checkpoint: {exc}", file=sys.stderr)
        return 2

    if checkpoint is None:
        print(f"graph-caster resume: no paused checkpoint found for run {run_id!r}", file=sys.stderr)
        return 1

    if checkpoint.paused_at_node != node_id:
        print(
            f"graph-caster resume: run is paused at node {checkpoint.paused_at_node!r}, "
            f"but --node={node_id!r} was provided",
            file=sys.stderr,
        )
        return 2

    effective_graphs_dir = graphs_dir
    if effective_graphs_dir is None:
        candidate = workspace / "graphs"
        if candidate.is_dir():
            effective_graphs_dir = candidate

    graph_file: Path | None = None
    if effective_graphs_dir is not None and effective_graphs_dir.is_dir():
        for cand in effective_graphs_dir.glob("*.json"):
            try:
                doc_raw = json.loads(cand.read_text(encoding="utf-8"))
                gid = str(doc_raw.get("graphId") or "")
                if not gid:
                    gid = str((doc_raw.get("meta") or {}).get("graphId") or "")
                if gid == checkpoint.graph_id:
                    graph_file = cand
                    break
            except Exception:
                pass

    if graph_file is None:
        print(
            f"graph-caster resume: graph document for graphId {checkpoint.graph_id!r} not found",
            file=sys.stderr,
        )
        return 2

    responded_at = _dt.datetime.now(_dt.timezone.utc).isoformat()
    node_outputs = dict(checkpoint.node_outputs)
    node_outputs[node_id] = {
        "nodeType": "human_input",
        "humanInput": {
            "value": payload,
            "approved": payload if checkpoint.kind == "approval" else None,
            "respondedAt": responded_at,
            "respondedBy": responded_by,
            "timedOut": False,
        },
    }

    import tempfile as _tf

    with _tf.NamedTemporaryFile(
        mode="w", suffix=".json", delete=False, encoding="utf-8"
    ) as _ctxf:
        json.dump({"node_outputs": node_outputs}, _ctxf, ensure_ascii=False)
        ctx_json_path = _ctxf.name

    cmd = [
        sys.executable,
        "-m",
        "graph_caster",
        "run",
        "-d",
        str(graph_file),
        "--run-id",
        run_id,
        "--start",
        node_id,
        "--context-json",
        ctx_json_path,
        "--artifacts-base",
        str(workspace),
    ]
    if effective_graphs_dir is not None:
        cmd += ["-g", str(effective_graphs_dir)]

    try:
        _asyncio_r.run(store.delete(run_id))
    except Exception:
        pass

    try:
        proc = _sp.run(cmd, check=False)
        return proc.returncode
    except Exception as exc:
        print(f"graph-caster resume: spawn failed: {exc}", file=sys.stderr)
        return 2


def _cmd_share(args: argparse.Namespace) -> int:
    import asyncio as _asyncio_share

    from graph_caster.sharing import ShareLink, ShareLinkNotFoundError, ShareLinkStore

    workspace = Path(args.workspace).resolve()
    store = ShareLinkStore(workspace)

    if args.share_command == "create":
        graph_id = str(args.graph_id).strip()
        permissions = str(args.permissions or "view-and-run")
        graph_version: int | None = getattr(args, "version", None)
        expires_at: str | None = getattr(args, "expires_at", None)
        if expires_at:
            if "T" not in expires_at and len(expires_at) == 10:
                expires_at = expires_at + "T00:00:00+00:00"
        max_uses: int | None = getattr(args, "max_uses", None)

        lnk = ShareLink(
            id="",
            graph_id=graph_id,
            graph_version=graph_version,
            permissions=permissions,
            expires_at=expires_at,
            max_uses=max_uses,
            uses=0,
            created_by="",
            created_at="",
            metadata={},
        )
        created = _asyncio_share.run(store.create(lnk))
        from graph_caster.sharing import _link_url
        d = created.to_dict()
        d["url"] = _link_url(created.id)
        print(json.dumps(d, ensure_ascii=False, indent=2))
        return 0

    if args.share_command == "list":
        graph_id_filter: str | None = getattr(args, "graph_id", None)
        if graph_id_filter:
            links = _asyncio_share.run(store.list_for_graph(graph_id_filter))
        else:
            with store._lock:
                links = list(store._load_all().values())
        from graph_caster.sharing import _link_url
        out = [dict(lnk.to_dict(), url=_link_url(lnk.id)) for lnk in links]
        print(json.dumps(out, ensure_ascii=False, indent=2))
        return 0

    if args.share_command == "revoke":
        link_id = str(args.link_id).strip()
        try:
            _asyncio_share.run(store.revoke(link_id))
        except ShareLinkNotFoundError:
            print(f"share revoke: link {link_id!r} not found", file=sys.stderr)
            return 2
        print(json.dumps({"revoked": link_id}, ensure_ascii=False))
        return 0

    return 2


if __name__ == "__main__":
    raise SystemExit(main())
