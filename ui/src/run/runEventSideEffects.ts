// Copyright GraphCaster. All Rights Reserved.

import { parseRunEventLine } from "./parseRunEventLine";
import * as store from "./runSessionStore";

export function loadReplayNdjsonText(
  ndjson: string,
  sourceLabel: string,
  leadingNoticeLine?: string | null,
): void {
  store.runSessionBeginReplay(sourceLabel);
  if (leadingNoticeLine != null && leadingNoticeLine !== "") {
    store.runSessionAppendLine(leadingNoticeLine);
  }
  const lines = ndjson.split(/\r?\n/).filter((l) => l.trim() !== "");
  for (const line of lines) {
    store.runSessionAppendLine(line);
    applyRunnerNdjsonSideEffects(line);
  }
}

function eventRunKey(
  inReplay: boolean,
  sourceRunId: string | undefined,
  focused: string | null,
): string | null {
  if (inReplay) {
    return store.RUN_SESSION_REPLAY_SNAPSHOT_KEY;
  }
  if (sourceRunId != null && sourceRunId.trim() !== "") {
    return sourceRunId.trim();
  }
  if (focused != null && focused !== "") {
    return focused;
  }
  return null;
}

export function applyRunnerNdjsonSideEffects(line: string, sourceRunId?: string): void {
  const focused = store.runSessionGetFocusedRunIdForSideEffects();
  const inReplay = store.runSessionIsReplayActive();
  const ev = parseRunEventLine(line);
  if (!ev || typeof ev !== "object" || ev === null) {
    return;
  }
  const o = ev as Record<string, unknown>;
  const t = o.type;

  const runKey = eventRunKey(inReplay, sourceRunId, focused);

  if (t === "node_outputs_snapshot") {
    const nid = o.nodeId;
    const sn = o.snapshot;
    if (
      runKey != null &&
      typeof nid === "string" &&
      sn != null &&
      typeof sn === "object" &&
      !Array.isArray(sn)
    ) {
      store.runSessionSetNodeOutputSnapshotForRun(runKey, nid, sn as Record<string, unknown>);
    }
  }

  if (t === "node_enter" || t === "node_execute") {
    const nid = o.nodeId;
    if (runKey != null && typeof nid === "string") {
      store.runSessionSetActiveNodeIdForRun(runKey, nid);
    }
  }

  if (t === "run_finished" || t === "run_end" || t === "run_success") {
    if (runKey != null) {
      store.runSessionClearActiveNodeForRun(runKey);
    }
  }

  if (runKey != null) {
    store.runSessionApplyParsedRunEventToOverlay(runKey, o);
  }
}
