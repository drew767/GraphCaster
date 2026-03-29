// Copyright GraphCaster. All Rights Reserved.

import type { Edge } from "@xyflow/react";

/** Max rendered characters on the canvas edge pill (n8n-style readability). */
export const EDGE_CANVAS_LABEL_MAX_LEN = 48;

/**
 * Maps React Flow `edge.label` to a GraphCaster branch **condition** string (export + canvas pill input).
 *
 * **Convention:** GraphCaster only treats **string** labels as conditions. Values allowed by the broader
 * RF type (e.g. React nodes) are **ignored** here and round-trip as `condition: null` in JSON.
 */
export function flowEdgeLabelToCondition(label: Edge["label"]): string | null {
  if (label == null) {
    return null;
  }
  if (typeof label === "string") {
    const s = label.trim();
    return s === "" ? null : s;
  }
  return null;
}

export function truncateEdgeCanvasLabel(s: string, maxLen = EDGE_CANVAS_LABEL_MAX_LEN): string {
  const t = s.trim();
  if (t.length <= maxLen) {
    return t;
  }
  if (maxLen <= 1) {
    return "…".slice(0, maxLen);
  }
  return `${t.slice(0, maxLen - 1)}…`;
}

/**
 * Text for the branch edge pill: F4 `condition` and/or `ai_route` `routeDescription`
 * (see `graphDocumentToFlow` — condition → `label`, route → `edge.data`).
 */
export function edgeCanvasLabelText(opts: {
  condition: string | null;
  routeDescription: string;
  sourceIsAiRoute: boolean;
  branchFallbackLabel: string;
}): string {
  const rd = opts.routeDescription.trim();
  const cond = opts.condition?.trim() ?? "";

  if (opts.sourceIsAiRoute) {
    if (rd !== "") {
      return truncateEdgeCanvasLabel(rd);
    }
    if (cond !== "") {
      return truncateEdgeCanvasLabel(cond);
    }
    return truncateEdgeCanvasLabel(opts.branchFallbackLabel);
  }
  if (cond !== "") {
    return truncateEdgeCanvasLabel(cond);
  }
  return "";
}
