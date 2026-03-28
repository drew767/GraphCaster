// Copyright GraphCaster. All Rights Reserved.

import { edgeIdsForBranchAmbiguities, findBranchAmbiguities } from "./branchWarnings";
import { findHandleCompatibilityIssues } from "./handleCompatibility";
import { edgeIdsForStructureIssueHighlights, type StructureIssue } from "./structureWarnings";
import type { GraphDocumentJson } from "./types";

export function collectCanvasWarningEdgeIds(
  doc: GraphDocumentJson,
  structureIssues: StructureIssue[],
): Set<string> {
  const out = edgeIdsForBranchAmbiguities(doc, findBranchAmbiguities(doc));
  for (const h of findHandleCompatibilityIssues(doc)) {
    out.add(h.edgeId);
  }
  for (const id of edgeIdsForStructureIssueHighlights(doc, structureIssues)) {
    out.add(id);
  }
  return out;
}
