// Copyright Aura. All Rights Reserved.

import type { GraphDocumentJson } from "./types";

export type BranchAmbiguity = {
  sourceId: string;
  kind: "multiple_unconditional" | "duplicate_condition";
  detail?: string;
};

function isUnconditional(cond: string | null | undefined): boolean {
  if (cond == null) {
    return true;
  }
  return String(cond).trim() === "";
}

export function findBranchAmbiguities(doc: GraphDocumentJson): BranchAmbiguity[] {
  const edges = doc.edges ?? [];
  const bySource = new Map<string, typeof edges>();
  for (const e of edges) {
    const list = bySource.get(e.source) ?? [];
    list.push(e);
    bySource.set(e.source, list);
  }
  const out: BranchAmbiguity[] = [];
  for (const [sourceId, list] of bySource) {
    const uncond = list.filter((e) => isUnconditional(e.condition));
    if (uncond.length > 1) {
      out.push({ sourceId, kind: "multiple_unconditional" });
    }
    const conds = list
      .map((e) => (e.condition == null ? null : String(e.condition).trim()))
      .filter((c): c is string => c !== "");
    const seen = new Set<string>();
    for (const c of conds) {
      if (seen.has(c)) {
        out.push({ sourceId, kind: "duplicate_condition", detail: c });
        break;
      }
      seen.add(c);
    }
  }
  return out;
}
