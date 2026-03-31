// Copyright GraphCaster. All Rights Reserved.

import { analyzeTemplateCondition } from "./edgeConditionTemplates";
import { parseTimerDurationSec, waitForHasExecutableConfig } from "./structureWarnings";
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
    if (d.gcCursorAgent != null && typeof d.gcCursorAgent === "object") {
      return true;
    }
    return d.command != null || d.argv != null;
  }
  if (t === "graph_ref") {
    return true;
  }
  if (t === "mcp_tool") {
    return true;
  }
  if (t === "http_request") {
    const u = (n.data ?? {})["url"];
    return typeof u === "string" && u.trim() !== "";
  }
  if (t === "python_code") {
    const c = (n.data ?? {})["code"];
    return typeof c === "string" && c.trim() !== "";
  }
  if (t === "rag_query") {
    const d = n.data ?? {};
    const u = d["url"];
    const q = d["query"];
    return typeof u === "string" && u.trim() !== "" && typeof q === "string" && q.trim() !== "";
  }
  if (t === "delay" || t === "debounce") {
    return parseTimerDurationSec(n.data ?? {}) != null;
  }
  if (t === "wait_for") {
    return waitForHasExecutableConfig(n.data ?? {});
  }
  if (t === "set_variable") {
    const d = (n.data ?? {}) as Record<string, unknown>;
    const nameRaw = d.name ?? d.variableName;
    const name = typeof nameRaw === "string" ? nameRaw.trim() : "";
    if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      return false;
    }
    const op = String(d.operation ?? "").trim().toLowerCase();
    return ["set", "increment", "append", "delete"].includes(op);
  }
  if (t === "llm_agent") {
    const d = (n.data ?? {}) as Record<string, unknown>;
    const cmd = d.command;
    const argv = d.argv;
    let has = Array.isArray(argv) && argv.length > 0;
    if (!has && cmd != null) {
      if (typeof cmd === "string" && cmd.trim() !== "") {
        has = true;
      } else if (Array.isArray(cmd) && cmd.length > 0) {
        has = true;
      }
    }
    return has;
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

export function edgeIdsForBranchAmbiguities(
  doc: GraphDocumentJson,
  ambiguities: BranchAmbiguity[],
): Set<string> {
  const out = new Set<string>();
  const edges = doc.edges ?? [];
  for (const a of ambiguities) {
    if (typeof a.edgeId === "string" && a.edgeId.trim() !== "") {
      out.add(a.edgeId);
    }
    const fanoutEdges = edges.filter(
      (e) => e.source === a.sourceId && isErrorFanoutEdge(e) === (a.handleFanout === "error"),
    );
    if (a.kind === "multiple_unconditional") {
      for (const e of fanoutEdges) {
        if (isUnconditional(e.condition)) {
          out.add(e.id);
        }
      }
    } else if (a.kind === "duplicate_condition") {
      const d = (a.detail ?? "").trim();
      for (const e of fanoutEdges) {
        const c = e.condition == null ? "" : String(e.condition).trim();
        if (c === d) {
          out.add(e.id);
        }
      }
    } else if (a.kind === "out_error_unreachable") {
      for (const e of fanoutEdges) {
        out.add(e.id);
      }
    }
  }
  return out;
}
