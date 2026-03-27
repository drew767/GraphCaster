// Copyright GraphCaster. All Rights Reserved.

import { analyzeTemplateCondition } from "./edgeConditionTemplates";
import {
  EDGE_SOURCE_OUT_ERROR,
  normalizeEdgeHandleValue,
  pickEdgeHandleRaw,
} from "./normalizeHandles";
import type { GraphDocumentJson, GraphEdgeJson } from "./types";

export type BranchAmbiguity = {
  sourceId: string;
  edgeId?: string;
  kind:
    | "multiple_unconditional"
    | "duplicate_condition"
    | "out_error_unreachable"
    | "template_condition_invalid";
  detail?: string;
  handleFanout: "success" | "error";
};

function isUnconditional(cond: string | null | undefined): boolean {
  if (cond == null) {
    return true;
  }
  return String(cond).trim() === "";
}

function isErrorFanoutEdge(e: GraphEdgeJson): boolean {
  const er = e as Record<string, unknown>;
  const raw = pickEdgeHandleRaw(er, "sourceHandle", "source_handle");
  const h = normalizeEdgeHandleValue(raw, "out_default");
  return h === EDGE_SOURCE_OUT_ERROR;
}

function ambiguitiesForSubset(
  sourceId: string,
  list: GraphEdgeJson[],
  handleFanout: "success" | "error",
): BranchAmbiguity[] {
  const out: BranchAmbiguity[] = [];
  const uncond = list.filter((e) => isUnconditional(e.condition));
  if (uncond.length > 1) {
    out.push({ sourceId, kind: "multiple_unconditional", handleFanout });
  }
  const conds = list
    .map((e) => (e.condition == null ? null : String(e.condition).trim()))
    .filter((c): c is string => c !== "");
  const seen = new Set<string>();
  for (const c of conds) {
    if (seen.has(c)) {
      out.push({ sourceId, kind: "duplicate_condition", detail: c, handleFanout });
      break;
    }
    seen.add(c);
  }
  return out;
}

function nodeCanEmitFailFanout(doc: GraphDocumentJson, nodeId: string): boolean {
  const n = doc.nodes?.find((x) => x.id === nodeId);
  if (!n) {
    return false;
  }
  const t = String(n.type ?? "").trim();
  if (t === "task") {
    const d = (n.data ?? {}) as Record<string, unknown>;
    return d.command != null || d.argv != null;
  }
  if (t === "graph_ref") {
    return true;
  }
  return false;
}

export function findBranchAmbiguities(doc: GraphDocumentJson): BranchAmbiguity[] {
  const edges = doc.edges ?? [];
  const templateIssues: BranchAmbiguity[] = [];
  for (const e of edges) {
    const raw = e.condition;
    if (raw == null) {
      continue;
    }
    const cond = String(raw).trim();
    if (cond === "" || !cond.includes("{{")) {
      continue;
    }
    const a = analyzeTemplateCondition(cond);
    if (a === "none" || a === "ok") {
      continue;
    }
    templateIssues.push({
      sourceId: e.source,
      edgeId: e.id,
      kind: "template_condition_invalid",
      detail: a,
      handleFanout: isErrorFanoutEdge(e) ? "error" : "success",
    });
  }
  const bySource = new Map<string, GraphEdgeJson[]>();
  for (const e of edges) {
    const list = bySource.get(e.source) ?? [];
    list.push(e);
    bySource.set(e.source, list);
  }
  const result: BranchAmbiguity[] = [];
  for (const [sourceId, list] of bySource) {
    const successEdges = list.filter((e) => !isErrorFanoutEdge(e));
    const errorEdges = list.filter((e) => isErrorFanoutEdge(e));
    if (successEdges.length > 0) {
      result.push(...ambiguitiesForSubset(sourceId, successEdges, "success"));
    }
    if (errorEdges.length > 0) {
      result.push(...ambiguitiesForSubset(sourceId, errorEdges, "error"));
    }
  }
  const unreachableErr: BranchAmbiguity[] = [];
  const seenBad = new Set<string>();
  for (const e of edges) {
    if (!isErrorFanoutEdge(e)) {
      continue;
    }
    const sid = e.source;
    if (seenBad.has(sid) || nodeCanEmitFailFanout(doc, sid)) {
      continue;
    }
    seenBad.add(sid);
    unreachableErr.push({ sourceId: sid, kind: "out_error_unreachable", handleFanout: "error" });
  }
  result.push(...unreachableErr);
  return [...templateIssues, ...result];
}
