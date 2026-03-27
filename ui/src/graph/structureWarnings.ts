// Copyright GraphCaster. All Rights Reserved.

import type { GraphDocumentJson } from "./types";

export type StructureIssue =
  | { kind: "no_start" }
  | { kind: "multiple_starts"; ids: string[] }
  | { kind: "start_has_incoming"; startId: string };

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
  return issues;
}
