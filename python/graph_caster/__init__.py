# Copyright Aura. All Rights Reserved.

"""GraphCaster Python runner: load graph JSON, traverse with edge conditions, emit run events."""

from graph_caster.artifacts import (
    artifacts_runs_total_bytes,
    artifacts_tree_bytes_for_graph,
    clear_all_artifact_runs,
    clear_artifacts_for_graph,
    create_root_run_artifact_dir,
    tree_bytes,
)
from graph_caster.models import GraphDocument
from graph_caster.runner import GraphRunner
from graph_caster.validate import GraphStructureError, validate_graph_structure
from graph_caster.workspace import (
    WorkspaceIndexError,
    clear_graph_index_cache,
    resolve_graph_path,
    scan_graphs_directory,
)

__all__ = [
    "GraphDocument",
    "GraphRunner",
    "GraphStructureError",
    "WorkspaceIndexError",
    "artifacts_runs_total_bytes",
    "artifacts_tree_bytes_for_graph",
    "clear_all_artifact_runs",
    "clear_artifacts_for_graph",
    "create_root_run_artifact_dir",
    "clear_graph_index_cache",
    "tree_bytes",
    "resolve_graph_path",
    "scan_graphs_directory",
    "validate_graph_structure",
    "__version__",
]

__version__ = "0.1.0"
