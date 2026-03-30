// Copyright GraphCaster. All Rights Reserved.

import type { BranchAmbiguity } from "./branchWarnings";
import type { HandleCompatibilityIssue } from "./handleCompatibility";
import type { StructureIssue } from "./structureWarnings";
import type { GraphDocumentJson } from "./types";

export function structureIssueFocusNodeId(issue: StructureIssue): string | null {
  switch (issue.kind) {
    case "no_start":
    case "schema_version_mismatch":
      return null;
    case "multiple_starts":
      return issue.ids[0] ?? null;
    case "start_has_incoming":
      return issue.startId;
    case "unreachable_nodes":
      return issue.ids[0] ?? null;
    case "merge_few_inputs":
    case "fork_few_outputs":
    case "barrier_merge_no_success_incoming":
    case "ai_route_no_outgoing":
    case "ai_route_missing_route_descriptions":
    case "mcp_tool_empty_tool_name":
    case "mcp_tool_stdio_missing_command":
    case "mcp_tool_http_empty_url":
    case "mcp_tool_unknown_transport":
    case "http_request_empty_url":
    case "rag_query_empty_url":
    case "rag_query_empty_query":
    case "delay_invalid_duration":
    case "debounce_invalid_duration":
    case "wait_for_unknown_mode":
    case "wait_for_empty_path":
    case "wait_for_invalid_timeout":
    case "python_code_empty_code":
    case "llm_agent_empty_command":
      return issue.nodeId;
    case "barrier_merge_out_error_incoming":
      return issue.mergeNodeId;
    case "graph_ref_workspace_cycle":
      return null;
    default:
      return null;
  }
}

export function handleIssuePrimaryNodeId(issue: HandleCompatibilityIssue): string {
  if (issue.kind === "invalid_target_handle") {
    return issue.targetId;
  }
  return issue.sourceId;
}

export function branchIssueFocusNodeId(issue: BranchAmbiguity): string {
  return issue.sourceId;
}

export function branchIssueFocusEdgeId(issue: BranchAmbiguity): string | null {
  return issue.edgeId ?? null;
}

export function documentWithEdgeConditionCleared(
  doc: GraphDocumentJson,
  edgeId: string,
): GraphDocumentJson {
  const id = edgeId.trim();
  if (id === "") {
    return doc;
  }
  return {
    ...doc,
    edges: (doc.edges ?? []).map((e) => {
      return e.id === id ? { ...e, condition: null } : e;
    }),
  };
}
