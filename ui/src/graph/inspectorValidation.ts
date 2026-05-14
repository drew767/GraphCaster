// Copyright GraphCaster. All Rights Reserved.

import type { GraphDocumentJson } from "./types";

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function agentPromptFromNodeRaw(raw: Record<string, unknown>): string {
  for (const key of ["inputText", "input", "prompt", "userMessage"] as const) {
    const v = raw[key];
    if (typeof v === "string" && v.trim() !== "") {
      return v;
    }
  }
  return "";
}

export const GCPIN_PAYLOAD_WARN_BYTES = 262144;

export function payloadForGcPin(snapshot: Record<string, unknown>): Record<string, unknown> {
  const pr = snapshot.processResult;
  if (isPlainObject(pr)) {
    return { processResult: { ...pr } };
  }
  return { ...snapshot };
}

export function estimateJsonUtf8Bytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return 0;
  }
}

export function scalarGraphRefId(v: unknown): string {
  if (typeof v === "string" && v.trim() !== "") {
    return v.trim();
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return String(v);
  }
  return "";
}

export function graphRefTargetId(raw: Record<string, unknown>): string {
  const a = scalarGraphRefId(raw.targetGraphId);
  if (a !== "") {
    return a;
  }
  return scalarGraphRefId(raw.graphId);
}

export function logGraphRefPreviewUnexpected(err: unknown): void {
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.error("[InspectorPanel] loadGraphRefSnapshot rejected unexpectedly", err);
  }
}

export function inputsOutputsFromDoc(doc: GraphDocumentJson): {
  inputsText: string;
  outputsText: string;
} {
  const ins = doc.inputs;
  const outs = doc.outputs;
  return {
    inputsText: ins === undefined ? "[]" : JSON.stringify(ins, null, 2),
    outputsText: outs === undefined ? "[]" : JSON.stringify(outs, null, 2),
  };
}
