// Copyright GraphCaster. All Rights Reserved.

import { parseRunEventLine } from "./parseRunEventLine";
import * as store from "./runSessionStore";

export function applyRunnerNdjsonSideEffects(line: string): void {
  const ev = parseRunEventLine(line);
  if (!ev || typeof ev !== "object" || ev === null) {
    return;
  }
  const o = ev as Record<string, unknown>;
  const t = o.type;
  if (t === "node_enter" || t === "node_execute") {
    const nid = o.nodeId;
    if (typeof nid === "string") {
      store.runSessionSetActiveNodeId(nid);
    }
  }
  if (t === "node_outputs_snapshot") {
    const nid = o.nodeId;
    const sn = o.snapshot;
    if (
      typeof nid === "string" &&
      sn != null &&
      typeof sn === "object" &&
      !Array.isArray(sn)
    ) {
      store.runSessionSetNodeOutputSnapshot(nid, sn as Record<string, unknown>);
    }
  }
  if (t === "run_finished" || t === "run_end") {
    store.runSessionSetActiveNodeId(null);
  }
}
