// Copyright GraphCaster. All Rights Reserved.

export type BrokerWebSocketDispatchOps = {
  appendLine: (line: string) => void;
  applyNdjson: (line: string, runId: string) => void;
  onExit: (code: number | null) => void;
};

export function dispatchBrokerWebSocketJson(
  rid: string,
  parsed: unknown,
  ops: BrokerWebSocketDispatchOps,
): boolean {
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return false;
  }
  const m = parsed as Record<string, unknown>;
  if (m.runId !== rid) {
    return false;
  }
  const ch = m.channel;
  if (ch === "stdout" && typeof m.line === "string") {
    ops.appendLine(m.line);
    ops.applyNdjson(m.line, rid);
    return false;
  }
  if (ch === "stderr") {
    const pl = m.payload;
    let text: string;
    if (
      pl != null &&
      typeof pl === "object" &&
      !Array.isArray(pl) &&
      typeof (pl as { line?: unknown }).line === "string"
    ) {
      text = (pl as { line: string }).line;
    } else {
      text = JSON.stringify(pl ?? "");
    }
    ops.appendLine(`[stderr] ${text}`);
    return false;
  }
  if (ch === "exit") {
    const code = typeof m.code === "number" ? m.code : null;
    ops.onExit(code);
    return true;
  }
  return false;
}
