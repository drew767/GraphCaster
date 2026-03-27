// Copyright GraphCaster. All Rights Reserved.

import { findUnreachableWorkflowNodeIds } from "./reachability";
import type { GraphDocumentJson } from "./types";

export type StructureIssue =
  | { kind: "no_start" }
  | { kind: "multiple_starts"; ids: string[] }
  | { kind: "start_has_incoming"; startId: string }
  | { kind: "unreachable_nodes"; ids: string[] };

function isBlockingStructureIssue(issue: StructureIssue): boolean {
  switch (issue.kind) {
    case "unreachable_nodes":
      return false;
    case "no_start":
    case "multiple_starts":
    case "start_has_incoming":
      return true;
  }
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
  return issues;
}
