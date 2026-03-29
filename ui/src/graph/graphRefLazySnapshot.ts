// Copyright GraphCaster. All Rights Reserved.

import { comparableSchemaVersions, graphIdFromDocument, parseGraphDocumentJson } from "./parseDocument";
import type { GraphDocumentJson } from "./types";

/** Lightweight metadata loaded on demand for a nested graph (n8n/Dify-style lazy resolve). */
export type GraphRefLazySnapshot = {
  graphId: string | undefined;
  title?: string;
  workflowNodeCount: number;
  /** Single display value: root schemaVersion, else meta.schemaVersion if present. */
  schemaVersion?: number;
};

export type ParseGraphRefSnapshotTextResult =
  | { ok: true; snapshot: GraphRefLazySnapshot }
  | { ok: false; errorKind: "json" | "parse_doc" };

export type GraphRefSnapshotLoadResult =
  | { ok: true; snapshot: GraphRefLazySnapshot }
  | {
      ok: false;
      errorKind: "json" | "parse_doc" | "read" | "unknown_graph" | "no_workspace";
    };

export function buildGraphRefSnapshotFromParsed(doc: GraphDocumentJson): GraphRefLazySnapshot {
  const nodes = doc.nodes ?? [];
  const sv = comparableSchemaVersions(doc);
  const schemaVersion = sv.root !== undefined ? sv.root : sv.meta;
  return {
    graphId: graphIdFromDocument(doc),
    title: typeof doc.meta?.title === "string" && doc.meta.title.trim() !== "" ? doc.meta.title : undefined,
    workflowNodeCount: nodes.length,
    schemaVersion,
  };
}

export function parseGraphRefSnapshotFromJsonText(text: string): ParseGraphRefSnapshotTextResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, errorKind: "json" };
  }
  const doc = parseGraphDocumentJson(parsed);
  if (!doc) {
    return { ok: false, errorKind: "parse_doc" };
  }
  return { ok: true, snapshot: buildGraphRefSnapshotFromParsed(doc) };
}
