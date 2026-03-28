// Copyright GraphCaster. All Rights Reserved.

import type { WorkspaceGraphEntry } from "../lib/workspaceFs";
import { findUnreachableWorkflowNodeIds } from "./reachability";
import type { GraphDocumentJson, GraphEdgeJson } from "./types";
import { findWorkspaceGraphRefCycle } from "./workspaceGraphRefCycles";

const SOURCE_OUT_ERROR = "out_error";

export type StructureIssue =
  | { kind: "no_start" }
  | { kind: "multiple_starts"; ids: string[] }
  | { kind: "start_has_incoming"; startId: string }
  | { kind: "unreachable_nodes"; ids: string[] }
  | { kind: "merge_few_inputs"; nodeId: string; incomingEdges: number }
  | { kind: "fork_few_outputs"; nodeId: string; unconditionalOutgoing: number }
  | { kind: "barrier_merge_out_error_incoming"; edgeId: string; mergeNodeId: string }
  | { kind: "barrier_merge_no_success_incoming"; nodeId: string }
  | { kind: "graph_ref_workspace_cycle"; cycle: string[] }
  | { kind: "ai_route_no_outgoing"; nodeId: string; outgoingEdges: number }
  | {
      kind: "ai_route_missing_route_descriptions";
      nodeId: string;
      outgoingEdges: number;
      missingDescriptions: number;
    };

export function mergeModeFromNodeData(data: unknown): "passthrough" | "barrier" {
  if (data == null || typeof data !== "object" || Array.isArray(data)) {
    return "passthrough";
  }
  const v = (data as Record<string, unknown>).mode;
  if (v == null) {
    return "passthrough";
  }
  const s = String(v).trim().toLowerCase();
  return s === "barrier" ? "barrier" : "passthrough";
}

function edgeSourceHandle(e: GraphEdgeJson): string {
  const sh = e.sourceHandle ?? e.source_handle;
  return typeof sh === "string" && sh.trim() !== "" ? sh.trim() : "out_default";
}

function edgeRouteDescriptionText(e: GraphEdgeJson): string {
  const d = e.data;
  if (d != null && typeof d === "object" && !Array.isArray(d) && typeof d.routeDescription === "string") {
    return d.routeDescription.trim();
  }
  return "";
}

function edgeConditionEmpty(c: unknown): boolean {
  if (c == null) {
    return true;
  }
  if (typeof c === "string") {
    return c.trim() === "";
  }
  return false;
}

function isBlockingStructureIssue(issue: StructureIssue): boolean {
  switch (issue.kind) {
    case "unreachable_nodes":
    case "merge_few_inputs":
    case "fork_few_outputs":
    case "barrier_merge_out_error_incoming":
    case "barrier_merge_no_success_incoming":
      return false;
    case "no_start":
    case "multiple_starts":
    case "start_has_incoming":
    case "graph_ref_workspace_cycle":
      return true;
    case "ai_route_no_outgoing":
    case "ai_route_missing_route_descriptions":
      return false;
  }
}

export function workspaceGraphRefCycleIssues(entries: readonly WorkspaceGraphEntry[]): StructureIssue[] {
  if (entries.length === 0) {
    return [];
  }
  const cyc = findWorkspaceGraphRefCycle(
    entries.map((e) => ({ graphId: e.graphId, refTargets: e.refTargets })),
  );
  if (cyc == null) {
    return [];
  }
  return [{ kind: "graph_ref_workspace_cycle", cycle: [...cyc] }];
}

export function structureIssuesBlockRun(issues: StructureIssue[]): boolean {
  return issues.some(isBlockingStructureIssue);
}

export function findStructureIssues(doc: GraphDocumentJson): StructureIssue[] {
  const nodes = doc.nodes ?? [];
  const edges = doc.edges ?? [];
  const starts = nodes.filter((n) => n.type === "start");
  const issues: StructureIssue[] = [];
  if (starts.length === 0) {
    issues.push({ kind: "no_start" });
  } else if (starts.length > 1) {
    issues.push({ kind: "multiple_starts", ids: starts.map((s) => s.id) });
  }
  if (starts.length >= 1) {
    for (const s of starts) {
      if (edges.some((e) => e.target === s.id)) {
        issues.push({ kind: "start_has_incoming", startId: s.id });
      }
    }
  }
  if (starts.length === 1) {
    const only = starts[0];
    const incomingToStart = edges.some((e) => e.target === only.id);
    if (!incomingToStart) {
      const unreachable = findUnreachableWorkflowNodeIds(doc, only.id);
      if (unreachable.length > 0) {
        issues.push({ kind: "unreachable_nodes", ids: unreachable });
      }
    }
  }
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const mergeIncoming = new Map<string, number>();
  for (const e of edges) {
    const tgt = byId.get(e.target);
    if (!tgt || tgt.type !== "merge") {
      continue;
    }
    const src = byId.get(e.source);
    if (!src || src.type === "comment") {
      continue;
    }
    mergeIncoming.set(tgt.id, (mergeIncoming.get(tgt.id) ?? 0) + 1);
  }
  for (const n of nodes) {
    if (n.type !== "merge") {
      continue;
    }
    const cnt = mergeIncoming.get(n.id) ?? 0;
    if (cnt < 2) {
      issues.push({ kind: "merge_few_inputs", nodeId: n.id, incomingEdges: cnt });
    }
  }
  for (const n of nodes) {
    if (n.type !== "fork") {
      continue;
    }
    let u = 0;
    for (const e of edges) {
      if (e.source !== n.id) {
        continue;
      }
      if (edgeSourceHandle(e) === SOURCE_OUT_ERROR) {
        continue;
      }
      const tgt = byId.get(e.target);
      if (!tgt || tgt.type === "comment") {
        continue;
      }
      if (!edgeConditionEmpty(e.condition)) {
        continue;
      }
      u += 1;
    }
    if (u < 2) {
      issues.push({ kind: "fork_few_outputs", nodeId: n.id, unconditionalOutgoing: u });
    }
  }
  for (const e of edges) {
    if (edgeSourceHandle(e) !== SOURCE_OUT_ERROR) {
      continue;
    }
    const tgt = byId.get(e.target);
    if (!tgt || tgt.type !== "merge") {
      continue;
    }
    if (mergeModeFromNodeData(tgt.data) !== "barrier") {
      continue;
    }
    const eid = typeof e.id === "string" && e.id.trim() !== "" ? e.id : "";
    if (eid === "") {
      continue;
    }
    issues.push({
      kind: "barrier_merge_out_error_incoming",
      edgeId: eid,
      mergeNodeId: tgt.id,
    });
  }
  for (const n of nodes) {
    if (n.type !== "merge" || mergeModeFromNodeData(n.data) !== "barrier") {
      continue;
    }
    let hasSuccess = false;
    for (const e of edges) {
      if (e.target !== n.id || edgeSourceHandle(e) === SOURCE_OUT_ERROR) {
        continue;
      }
      const src = byId.get(e.source);
      if (!src || src.type === "comment") {
        continue;
      }
      hasSuccess = true;
      break;
    }
    if (!hasSuccess) {
      issues.push({ kind: "barrier_merge_no_success_incoming", nodeId: n.id });
    }
  }
  for (const n of nodes) {
    if (n.type !== "ai_route") {
      continue;
    }
    const usable: GraphEdgeJson[] = [];
    for (const e of edges) {
      if (e.source !== n.id) {
        continue;
      }
      if (edgeSourceHandle(e) === SOURCE_OUT_ERROR) {
        continue;
      }
      const tgt = byId.get(e.target);
      if (!tgt || tgt.type === "comment") {
        continue;
      }
      usable.push(e);
    }
    if (usable.length === 0) {
      issues.push({ kind: "ai_route_no_outgoing", nodeId: n.id, outgoingEdges: 0 });
    } else if (usable.length > 1) {
      const missing = usable.filter((e) => edgeRouteDescriptionText(e) === "").length;
      if (missing > 0) {
        issues.push({
          kind: "ai_route_missing_route_descriptions",
          nodeId: n.id,
          outgoingEdges: usable.length,
          missingDescriptions: missing,
        });
      }
    }
  }
  return issues;
}
