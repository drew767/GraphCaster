// Copyright GraphCaster. All Rights Reserved.

import { parseRunEventLine } from "../../run/parseRunEventLine";
import type { HistoryRunEvent } from "../../stores/historyStore";

export function ndjsonTextToRunEvents(text: string): HistoryRunEvent[] {
  const lines = text.split(/\r?\n/);
  const out: HistoryRunEvent[] = [];
  let index = 0;
  for (const raw of lines) {
    const parsed = parseRunEventLine(raw);
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      continue;
    }
    const o = parsed as Record<string, unknown>;
    const type = typeof o.type === "string" ? o.type : "";
    const runId = typeof o.runId === "string" ? o.runId : typeof o.run_id === "string" ? o.run_id : "";
    const ts =
      typeof o.timestamp === "string"
        ? o.timestamp
        : typeof o.ts === "string"
          ? o.ts
          : "";
    const nodeId =
      typeof o.nodeId === "string"
        ? o.nodeId
        : typeof o.node_id === "string"
          ? o.node_id
          : undefined;
    out.push({
      type,
      runId,
      nodeId,
      timestamp: ts,
      data: o,
      index,
    });
    index += 1;
  }
  return out;
}
