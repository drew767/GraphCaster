// Copyright GraphCaster. All Rights Reserved.

import type { GraphDocumentJson } from "../graph/types";
import { parseGraphDocumentJsonResult } from "../graph/parseDocument";
import { extractPngChunks, parseTextChunk } from "./png_chunks";

const PNG_WORKFLOW_CHUNK_KEY = "workflow";

/**
 * Result of a workflow import attempt.
 * - `ok: true`  → `doc` is the parsed GraphDocumentJson.
 * - `ok: false` → `reason` explains what went wrong.
 * - `null`      → file type is not supported (not JSON or PNG).
 */
export type WorkflowImportResult =
  | { ok: true; doc: GraphDocumentJson }
  | { ok: false; reason: "parse_error" | "no_workflow_chunk" | "invalid_json" | "read_error" }
  | null;

/**
 * Parse a GraphDocumentJson from a File (JSON or PNG with embedded workflow).
 *
 * Returns null when the file type is not recognized.
 * Returns `{ ok: false }` when the file is recognized but could not be parsed.
 * Returns `{ ok: true, doc }` on success.
 *
 * Forward-permissive: if schemaVersion is older than the current schema, the
 * document is accepted anyway (the parser normalises what it can).
 */
export async function importWorkflowFromFile(file: File): Promise<WorkflowImportResult> {
  if (file.type === "application/json" || file.name.endsWith(".json")) {
    return importFromJson(file);
  }
  if (file.type === "image/png" || file.name.endsWith(".png")) {
    return importFromPng(file);
  }
  return null;
}

async function importFromJson(file: File): Promise<WorkflowImportResult> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, reason: "read_error" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  const res = parseGraphDocumentJsonResult(parsed);
  if (!res.ok) {
    return { ok: false, reason: "parse_error" };
  }
  return { ok: true, doc: res.doc };
}

async function importFromPng(file: File): Promise<WorkflowImportResult> {
  let arrayBuffer: ArrayBuffer;
  try {
    arrayBuffer = await file.arrayBuffer();
  } catch {
    return { ok: false, reason: "read_error" };
  }

  let chunks;
  try {
    const arr = new Uint8Array(arrayBuffer);
    chunks = extractPngChunks(arr);
  } catch {
    return { ok: false, reason: "read_error" };
  }

  if (chunks.length === 0) {
    return { ok: false, reason: "no_workflow_chunk" };
  }

  const workflowChunk = chunks.find(
    (c) => c.name === "tEXt" && parseTextChunk(c.data)?.key === PNG_WORKFLOW_CHUNK_KEY,
  );
  if (!workflowChunk) {
    return { ok: false, reason: "no_workflow_chunk" };
  }

  const parsed = parseTextChunk(workflowChunk.data);
  if (!parsed) {
    return { ok: false, reason: "invalid_json" };
  }

  let rawJson: unknown;
  try {
    rawJson = JSON.parse(parsed.text);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }

  const res = parseGraphDocumentJsonResult(rawJson);
  if (!res.ok) {
    return { ok: false, reason: "parse_error" };
  }
  return { ok: true, doc: res.doc };
}
