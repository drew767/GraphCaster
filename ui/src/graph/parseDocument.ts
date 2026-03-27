// Copyright Aura. All Rights Reserved.

import { normalizeEdgeHandleValue, pickEdgeHandleRaw } from "./normalizeHandles";
import type { GraphDocumentJson } from "./types";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function normalizeSchemaVersionField(v: unknown): number | undefined {
  if (v === undefined) {
    return undefined;
  }
  if (typeof v === "boolean") {
    return v ? 1 : 0;
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return Math.trunc(v);
  }
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) {
    return parseInt(v.trim(), 10);
  }
  return undefined;
}

function isSchemaVersionAcceptable(v: unknown): boolean {
  if (v === undefined) {
    return true;
  }
  return normalizeSchemaVersionField(v) !== undefined;
}

function coerceGraphIdField(v: unknown): { ok: true; value: string | undefined } | { ok: false } {
  if (v === undefined || v === null) {
    return { ok: true, value: undefined };
  }
  if (typeof v === "string") {
    const t = v.trim();
    return { ok: true, value: t === "" ? undefined : t };
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return { ok: true, value: String(v) };
  }
  return { ok: false };
}

/** Aligns with Python `_normalize_edge_condition` for scalars; object/array → `null`. */
function normalizeEdgeConditionParsed(cond: unknown): string | null | undefined {
  if (cond === undefined) {
    return undefined;
  }
  if (cond === null) {
    return null;
  }
  if (typeof cond === "string") {
    return cond;
  }
  if (typeof cond === "boolean") {
    return cond ? "true" : "false";
  }
  if (typeof cond === "number" && Number.isFinite(cond)) {
    return String(cond);
  }
  return null;
}

export function graphIdFromDocument(doc: GraphDocumentJson): string | undefined {
  const m = doc.meta?.graphId;
  if (typeof m === "string" && m.trim() !== "") {
    return m.trim();
  }
  if (typeof m === "number" && Number.isFinite(m)) {
    return String(m);
  }
  const g = doc.graphId;
  if (typeof g === "string" && g.trim() !== "") {
    return g.trim();
  }
  if (typeof g === "number" && Number.isFinite(g)) {
    return String(g);
  }
  return undefined;
}

export function parseGraphDocumentJson(raw: unknown): GraphDocumentJson | null {
  if (!isPlainObject(raw)) {
    return null;
  }
  const o = raw;
  if (o.meta !== undefined && !isPlainObject(o.meta)) {
    return null;
  }
  if (o.viewport !== undefined && !isPlainObject(o.viewport)) {
    return null;
  }
  if ("schemaVersion" in o && o.schemaVersion !== undefined && !isSchemaVersionAcceptable(o.schemaVersion)) {
    return null;
  }
  if (isPlainObject(o.meta)) {
    const ms = o.meta.schemaVersion;
    if (ms !== undefined && !isSchemaVersionAcceptable(ms)) {
      return null;
    }
  }
  const oo = o as Record<string, unknown>;
  const nodesRaw = oo.nodes;
  const edgesRaw = oo.edges;
  if (nodesRaw === undefined) {
    oo.nodes = [];
  } else if (!Array.isArray(nodesRaw)) {
    return null;
  }
  if (edgesRaw === undefined) {
    oo.edges = [];
  } else if (!Array.isArray(edgesRaw)) {
    return null;
  }
  const nodesArr = oo.nodes as unknown[];
  const edgesArr = oo.edges as unknown[];
  for (const node of nodesArr) {
    if (!isPlainObject(node)) {
      return null;
    }
    if (typeof node.id !== "string" || node.id.trim().length === 0) {
      return null;
    }
    const nr = node as Record<string, unknown>;
    nr.id = node.id.trim();
    const tRaw = nr.type;
    if (tRaw === undefined || tRaw === null) {
      nr.type = "unknown";
    } else {
      const t = String(tRaw).trim();
      nr.type = t === "" ? "unknown" : t;
    }
    if (node.data !== undefined && !isPlainObject(node.data)) {
      return null;
    }
    if (node.position !== undefined && !isPlainObject(node.position)) {
      return null;
    }
  }
  for (const edge of edgesArr) {
    if (!isPlainObject(edge)) {
      return null;
    }
    if (typeof edge.id !== "string" || edge.id.trim().length === 0) {
      return null;
    }
    if (typeof edge.source !== "string" || typeof edge.target !== "string") {
      return null;
    }
    if (edge.source.trim() === "" || edge.target.trim() === "") {
      return null;
    }
    const er = edge as Record<string, unknown>;
    er.id = edge.id.trim();
    er.source = edge.source.trim();
    er.target = edge.target.trim();
    if ("condition" in er) {
      er.condition = normalizeEdgeConditionParsed(er.condition) ?? null;
    }
    const shRaw = pickEdgeHandleRaw(er, "sourceHandle", "source_handle");
    const thRaw = pickEdgeHandleRaw(er, "targetHandle", "target_handle");
    er.sourceHandle = normalizeEdgeHandleValue(shRaw, "out_default");
    er.targetHandle = normalizeEdgeHandleValue(thRaw, "in_default");
    delete er.source_handle;
    delete er.target_handle;
  }

  if ("schemaVersion" in oo && oo.schemaVersion !== undefined) {
    const n = normalizeSchemaVersionField(oo.schemaVersion);
    if (n === undefined) {
      return null;
    }
    oo.schemaVersion = n;
  }
  if (isPlainObject(o.meta)) {
    const mo = o.meta as Record<string, unknown>;
    if ("schemaVersion" in mo && mo.schemaVersion !== undefined) {
      const n = normalizeSchemaVersionField(mo.schemaVersion);
      if (n === undefined) {
        return null;
      }
      mo.schemaVersion = n;
    }
    if ("graphId" in mo) {
      const g = coerceGraphIdField(mo.graphId);
      if (!g.ok) {
        return null;
      }
      if (g.value === undefined) {
        delete mo.graphId;
      } else {
        mo.graphId = g.value;
      }
    }
    if ("author" in mo && mo.author != null) {
      mo.author = String(mo.author);
    }
    if ("title" in mo && mo.title != null) {
      mo.title = String(mo.title);
    }
  }
  if ("graphId" in oo) {
    const g = coerceGraphIdField(oo.graphId);
    if (!g.ok) {
      return null;
    }
    if (g.value === undefined) {
      delete oo.graphId;
    } else {
      oo.graphId = g.value;
    }
  }

  return raw as GraphDocumentJson;
}
