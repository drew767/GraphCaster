// Copyright GraphCaster. All Rights Reserved.

import type { WorkspaceGraphEntry } from "../lib/workspaceFs";
import { findUnreachableWorkflowNodeIds } from "./reachability";
import type { GraphDocumentJson } from "./types";
import { findWorkspaceGraphRefCycle } from "./workspaceGraphRefCycles";

export type StructureIssue =
  | { kind: "no_start" }
  | { kind: "multiple_starts"; ids: string[] }
  | { kind: "start_has_incoming"; startId: string }
  | { kind: "unreachable_nodes"; ids: string[] }
  | { kind: "merge_few_inputs"; nodeId: string; incomingEdges: number }
  | { kind: "graph_ref_workspace_cycle"; cycle: string[] };

function isBlockingStructureIssue(issue: StructureIssue): boolean {
  switch (issue.kind) {
    case "unreachable_nodes":
    case "merge_few_inputs":
      return false;
    case "no_start":
    case "multiple_starts":
    case "start_has_incoming":
    case "graph_ref_workspace_cycle":
      return true;
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
  return issues;
}
