// Copyright GraphCaster. All Rights Reserved.

import {
  parseGraphDocumentJsonResult,
  type GraphDocumentParseError,
  type ParseGraphDocumentJsonResult,
} from "../graph/parseDocument";
import type { GraphDocumentJson } from "../graph/types";

export type { GraphDocumentJson, GraphDocumentParseError, ParseGraphDocumentJsonResult };

/**
 * Parse a graph document from JSON text or a pre-parsed value (host embed entry).
 * Invalid JSON text yields **`{ ok: false, error: { kind: "invalid_json" } }`**.
 */
export function loadGraph(input: string | unknown): ParseGraphDocumentJsonResult {
  if (typeof input === "string") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input);
    } catch {
      return { ok: false, error: { kind: "invalid_json" } };
    }
    return parseGraphDocumentJsonResult(parsed);
  }
  return parseGraphDocumentJsonResult(input);
}

/** Namespace for host documentation / `window` attachment. */
export const GraphCasterEmbed = {
  loadGraph,
} as const;
