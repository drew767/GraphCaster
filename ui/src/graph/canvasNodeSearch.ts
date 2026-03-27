// Copyright GraphCaster. All Rights Reserved.

import type { GraphDocumentJson } from "./types";
import { nodeLabel } from "./toReactFlow";

export type CanvasNodeSearchRow = {
  id: string;
  graphNodeType: string;
  displayLabel: string;
  searchableText: string;
};

function graphRefSearchTokens(data: Record<string, unknown>): string[] {
  const tokens: string[] = [];
  for (const key of ["graphId", "targetGraphId"] as const) {
    const v = data[key];
    if (typeof v === "string" && v.trim() !== "") {
      tokens.push(v.trim().toLowerCase());
    }
  }
  return tokens;
}

export function buildCanvasNodeSearchRows(doc: GraphDocumentJson): CanvasNodeSearchRow[] {
  const raw = doc.nodes ?? [];
  const rows: CanvasNodeSearchRow[] = [];
  for (const n of raw) {
    if (typeof n.id !== "string" || n.id.trim() === "") {
      continue;
    }
    const id = n.id.trim();
    const data = n.data && typeof n.data === "object" && n.data !== null ? (n.data as Record<string, unknown>) : {};
    const graphNodeType = typeof n.type === "string" && n.type.length > 0 ? n.type : "unknown";
    const displayLabel = nodeLabel(data, id);
    const parts = [id.toLowerCase(), graphNodeType.toLowerCase(), displayLabel.toLowerCase(), ...graphRefSearchTokens(data)];
    const searchableText = parts.join("\u0000");
    rows.push({
      id,
      graphNodeType,
      displayLabel,
      searchableText,
    });
  }
  rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return rows;
}

export function filterCanvasNodeSearchRows(
  rows: readonly CanvasNodeSearchRow[],
  query: string,
): CanvasNodeSearchRow[] {
  const q = query.trim().toLowerCase();
  if (q === "") {
    return [...rows];
  }
  return rows.filter((r) => r.searchableText.includes(q));
}
