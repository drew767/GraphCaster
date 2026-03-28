# Copyright GraphCaster. All Rights Reserved.

"""GraphCaster Python runner: load graph JSON, traverse with edge conditions, emit run events."""

from graph_caster.artifacts import (
    artifacts_runs_total_bytes,
    artifacts_tree_bytes_for_graph,
    clear_all_artifact_runs,
    clear_artifacts_for_graph,
    create_root_run_artifact_dir,
    tree_bytes,
)
from graph_caster.document_revision import graph_document_revision
from graph_caster.handle_contract import find_handle_compatibility_violations
from graph_caster.host_context import RunHostContext
from graph_caster.models import GraphDocument
from graph_caster.node_output_cache import (
    StepCachePolicy,
    StepCacheStore,
    compute_step_cache_key,
    node_data_for_cache_key,
    normalize_outputs_for_cache_key,
    stable_json,
    step_cache_root,
    upstream_outputs_fingerprint,
    upstream_step_cache_fingerprint,
)
from graph_caster.run_event_sink import NdjsonStdoutSink, RunEventDict, RunEventSink, normalize_run_event_sink
from graph_caster.runner import GraphRunner
from graph_caster.run_sessions import (
    RunSession,
    RunSessionRegistry,
    get_default_run_registry,
    reset_default_run_registry,
)
from graph_caster.graph_ref_workspace import (
    build_workspace_graph_ref_adjacency,
    find_workspace_graph_ref_cycle,
)
from graph_caster.validate import (
    GraphStructureError,
    find_barrier_merge_no_success_incoming_warnings,
    find_barrier_merge_out_error_incoming,
    find_fork_few_outputs_warnings,
    find_merge_incoming_warnings,
    find_unreachable_non_comment_nodes,
    find_unreachable_out_error_sources,
    merge_mode,
    validate_graph_structure,
)
from graph_caster.workspace import (
    WorkspaceIndexError,
    clear_graph_index_cache,
    load_graph_documents_index,
    resolve_graph_path,
    scan_graphs_directory,
)

__all__ = [
    "build_workspace_graph_ref_adjacency",
    "find_workspace_graph_ref_cycle",
    "find_handle_compatibility_violations",
    "compute_step_cache_key",
    "graph_document_revision",
    "GraphDocument",
    "GraphRunner",
    "NdjsonStdoutSink",
    "RunEventDict",
    "RunEventSink",
    "normalize_run_event_sink",
    "RunHostContext",
    "RunSession",
    "RunSessionRegistry",
    "get_default_run_registry",
    "node_data_for_cache_key",
    "normalize_outputs_for_cache_key",
    "reset_default_run_registry",
    "stable_json",
    "StepCachePolicy",
    "StepCacheStore",
    "step_cache_root",
    "GraphStructureError",
    "WorkspaceIndexError",
    "artifacts_runs_total_bytes",
    "artifacts_tree_bytes_for_graph",
    "clear_all_artifact_runs",
    "clear_artifacts_for_graph",
    "create_root_run_artifact_dir",
    "clear_graph_index_cache",
    "tree_bytes",
    "upstream_outputs_fingerprint",
    "upstream_step_cache_fingerprint",
    "resolve_graph_path",
    "load_graph_documents_index",
    "scan_graphs_directory",
    "validate_graph_structure",
    "find_barrier_merge_no_success_incoming_warnings",
    "find_barrier_merge_out_error_incoming",
    "find_fork_few_outputs_warnings",
    "find_merge_incoming_warnings",
    "find_unreachable_non_comment_nodes",
    "find_unreachable_out_error_sources",
    "merge_mode",
    "__version__",
]

__version__ = "0.1.0"
