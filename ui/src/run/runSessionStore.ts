// Copyright GraphCaster. All Rights Reserved.

import { useSyncExternalStore } from "react";

const MAX_LINES_PER_RUN = 2000;

export const LS_MAX_CONCURRENT_RUNS = "gc.run.maxConcurrent";

/** Internal bucket for replay NDJSON (offline); not a live `runId`. */
export const RUN_SESSION_REPLAY_SNAPSHOT_KEY = "__gc_replay__";

export type GcStartRunJob = {
  documentJson: string;
  runId: string;
  graphsDir?: string;
  artifactsBase?: string;
  untilNodeId?: string;
  contextJsonPath?: string;
  stepCache?: boolean;
  stepCacheDirty?: string;
};

export type RunSessionSnapshot = {
  consoleLines: string[];
  activeRunId: string | null;
  liveRunIds: readonly string[];
  focusedRunId: string | null;
  pendingRunCount: number;
  activeNodeId: string | null;
  pythonBanner: string | null;
  lastExitCode: number | null;
  nodeOutputSnapshots: Record<string, Record<string, unknown>>;
  replaySourceLabel: string | null;
};

type InternalState = {
  liveRunOrder: string[];
  focusedRunId: string | null;
  consoleByRunId: Record<string, string[]>;
  pendingStarts: GcStartRunJob[];
  replaySourceLabel: string | null;
  replayLines: string[];
  activeNodeIdByRunId: Record<string, string>;
  pythonBanner: string | null;
  lastExitCode: number | null;
  outputSnapshotsByRunId: Record<string, Record<string, Record<string, unknown>>>;
};

function trimBuffer(lines: string[]): string[] {
  if (lines.length <= MAX_LINES_PER_RUN) {
    return lines;
  }
  return lines.slice(-MAX_LINES_PER_RUN);
}

function publicNodeOutputSnapshots(s: InternalState): Record<string, Record<string, unknown>> {
  const replay = s.replaySourceLabel != null;
  if (replay) {
    return s.outputSnapshotsByRunId[RUN_SESSION_REPLAY_SNAPSHOT_KEY] ?? {};
  }
  if (s.focusedRunId != null) {
    return s.outputSnapshotsByRunId[s.focusedRunId] ?? {};
  }
  return {};
}

function publicActiveNodeId(s: InternalState): string | null {
  const replay = s.replaySourceLabel != null;
  if (replay) {
    const v = s.activeNodeIdByRunId[RUN_SESSION_REPLAY_SNAPSHOT_KEY];
    return v ?? null;
  }
  if (s.focusedRunId != null) {
    const v = s.activeNodeIdByRunId[s.focusedRunId];
    return v ?? null;
  }
  return null;
}

function buildPublicSnapshot(s: InternalState): RunSessionSnapshot {
  const replay = s.replaySourceLabel != null;
  const lines = replay
    ? s.replayLines
    : s.focusedRunId != null
      ? (s.consoleByRunId[s.focusedRunId] ?? [])
      : [];
  return {
    consoleLines: lines,
    activeRunId: s.focusedRunId,
    liveRunIds: Object.freeze([...s.liveRunOrder]),
    focusedRunId: s.focusedRunId,
    pendingRunCount: s.pendingStarts.length,
    activeNodeId: publicActiveNodeId(s),
    pythonBanner: s.pythonBanner,
    lastExitCode: s.lastExitCode,
    nodeOutputSnapshots: publicNodeOutputSnapshots(s),
    replaySourceLabel: s.replaySourceLabel,
  };
}

let internal: InternalState = {
  liveRunOrder: [],
  focusedRunId: null,
  consoleByRunId: {},
  pendingStarts: [],
  replaySourceLabel: null,
  replayLines: [],
  activeNodeIdByRunId: {},
  pythonBanner: null,
  lastExitCode: null,
  outputSnapshotsByRunId: {},
};

let publicSnap: RunSessionSnapshot = buildPublicSnapshot(internal);

const listeners = new Set<() => void>();

function emit(): void {
  publicSnap = buildPublicSnapshot(internal);
  for (const c of listeners) {
    c();
  }
}

export function subscribeRunSession(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

export function getRunSessionSnapshot(): RunSessionSnapshot {
  return publicSnap;
}

export function runSessionIsReplayActive(): boolean {
  return internal.replaySourceLabel != null;
}

export function getMaxConcurrentRuns(): number {
  if (typeof localStorage === "undefined") {
    return 2;
  }
  const raw = localStorage.getItem(LS_MAX_CONCURRENT_RUNS);
  const n = raw != null ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n)) {
    return 2;
  }
  return Math.min(32, Math.max(1, n));
}

export function runSessionLiveRunCount(): number {
  return internal.liveRunOrder.length;
}

export function runSessionPendingCount(): number {
  return internal.pendingStarts.length;
}

export function runSessionHasBlockingActivity(): boolean {
  return internal.liveRunOrder.length > 0 || internal.pendingStarts.length > 0;
}

export function runSessionCanStartAnotherLive(): boolean {
  return internal.liveRunOrder.length < getMaxConcurrentRuns();
}

export function runSessionEnqueuePending(job: GcStartRunJob): void {
  internal = { ...internal, pendingStarts: [...internal.pendingStarts, job] };
  emit();
}

export function runSessionRegisterLiveRun(runId: string): void {
  const rid = runId.trim();
  if (rid === "") {
    return;
  }
  if (internal.liveRunOrder.includes(rid)) {
    internal = { ...internal, focusedRunId: rid };
    emit();
    return;
  }
  const consoleByRunId = {
    ...internal.consoleByRunId,
    [rid]: internal.consoleByRunId[rid] ?? [],
  };
  internal = {
    ...internal,
    liveRunOrder: [...internal.liveRunOrder, rid],
    focusedRunId: rid,
    consoleByRunId,
  };
  emit();
}

export function runSessionSetFocusedRunId(runId: string | null): void {
  if (runId == null) {
    internal = { ...internal, focusedRunId: null };
    emit();
    return;
  }
  const rid = runId.trim();
  if (rid === "" || !internal.liveRunOrder.includes(rid)) {
    return;
  }
  internal = { ...internal, focusedRunId: rid };
  emit();
}

function pickFocusAfterRemove(liveRunOrder: string[], prevFocus: string | null): string | null {
  if (liveRunOrder.length === 0) {
    return null;
  }
  if (prevFocus != null && liveRunOrder.includes(prevFocus)) {
    return prevFocus;
  }
  return liveRunOrder[liveRunOrder.length - 1] ?? null;
}

function takeNextPendingIfUnderCap(liveCount: number): { pending: GcStartRunJob[]; next: GcStartRunJob | null } {
  const cap = getMaxConcurrentRuns();
  if (internal.pendingStarts.length === 0 || liveCount >= cap) {
    return { pending: internal.pendingStarts, next: null };
  }
  return {
    pending: internal.pendingStarts.slice(1),
    next: internal.pendingStarts[0]!,
  };
}

export function runSessionAbortRegisteredRun(runId: string): GcStartRunJob | null {
  const rid = runId.trim();
  if (rid === "" || !internal.liveRunOrder.includes(rid)) {
    return null;
  }
  const prevFocus = internal.focusedRunId;
  const liveRunOrder = internal.liveRunOrder.filter((x) => x !== rid);
  const { [rid]: _c, ...restConsole } = internal.consoleByRunId;
  const { [rid]: _s, ...restSnaps } = internal.outputSnapshotsByRunId;
  const { [rid]: _a, ...restActive } = internal.activeNodeIdByRunId;
  const newFocus = pickFocusAfterRemove(liveRunOrder, prevFocus);
  const { pending, next } = takeNextPendingIfUnderCap(liveRunOrder.length);
  internal = {
    ...internal,
    liveRunOrder,
    focusedRunId: newFocus,
    consoleByRunId: restConsole,
    outputSnapshotsByRunId: restSnaps,
    activeNodeIdByRunId: restActive,
    pendingStarts: pending,
  };
  emit();
  return next;
}

export function runSessionOnRunProcessExited(
  runId: string,
  code: number | null,
): GcStartRunJob | null {
  const rid = runId.trim();
  if (rid === "" || !internal.liveRunOrder.includes(rid)) {
    return null;
  }
  const wasFocused = internal.focusedRunId === rid;
  const prevFocus = internal.focusedRunId;
  const liveRunOrder = internal.liveRunOrder.filter((x) => x !== rid);
  const { [rid]: _c, ...restConsole } = internal.consoleByRunId;
  const { [rid]: _s, ...restSnaps } = internal.outputSnapshotsByRunId;
  const { [rid]: _a, ...restActive } = internal.activeNodeIdByRunId;
  const newFocus = pickFocusAfterRemove(liveRunOrder, prevFocus);
  const { pending, next } = takeNextPendingIfUnderCap(liveRunOrder.length);
  const setExit = wasFocused || liveRunOrder.length === 0;
  internal = {
    ...internal,
    liveRunOrder,
    focusedRunId: newFocus,
    consoleByRunId: restConsole,
    outputSnapshotsByRunId: restSnaps,
    activeNodeIdByRunId: restActive,
    pendingStarts: pending,
    lastExitCode: setExit ? code : internal.lastExitCode,
  };
  emit();
  return next;
}

export function runSessionAppendLineForRun(runId: string, text: string): void {
  const rid = runId.trim();
  if (rid === "") {
    return;
  }
  if (internal.replaySourceLabel != null) {
    internal = {
      ...internal,
      replayLines: trimBuffer([...internal.replayLines, text]),
    };
    emit();
    return;
  }
  const prev = internal.consoleByRunId[rid] ?? [];
  const consoleByRunId = {
    ...internal.consoleByRunId,
    [rid]: trimBuffer([...prev, text]),
  };
  internal = { ...internal, consoleByRunId };
  emit();
}

export function runSessionAppendLine(text: string): void {
  if (internal.replaySourceLabel != null) {
    internal = {
      ...internal,
      replayLines: trimBuffer([...internal.replayLines, text]),
    };
    emit();
    return;
  }
  const fid = internal.focusedRunId;
  if (fid == null) {
    return;
  }
  runSessionAppendLineForRun(fid, text);
}

export function runSessionClearConsole(): void {
  if (internal.replaySourceLabel != null) {
    internal = { ...internal, replayLines: [] };
    emit();
    return;
  }
  const fid = internal.focusedRunId;
  if (fid == null) {
    return;
  }
  const consoleByRunId = { ...internal.consoleByRunId, [fid]: [] };
  internal = { ...internal, consoleByRunId };
  emit();
}

export function runSessionBeginReplay(sourceLabel: string): void {
  const outputSnapshotsByRunId = {
    ...internal.outputSnapshotsByRunId,
    [RUN_SESSION_REPLAY_SNAPSHOT_KEY]: {},
  };
  const activeNodeIdByRunId = { ...internal.activeNodeIdByRunId };
  delete activeNodeIdByRunId[RUN_SESSION_REPLAY_SNAPSHOT_KEY];
  internal = {
    ...internal,
    replaySourceLabel: sourceLabel,
    replayLines: [],
    outputSnapshotsByRunId,
    activeNodeIdByRunId,
    lastExitCode: null,
  };
  emit();
}

export function runSessionClearReplay(): void {
  if (internal.replaySourceLabel == null) {
    return;
  }
  const outputSnapshotsByRunId = { ...internal.outputSnapshotsByRunId };
  delete outputSnapshotsByRunId[RUN_SESSION_REPLAY_SNAPSHOT_KEY];
  const activeNodeIdByRunId = { ...internal.activeNodeIdByRunId };
  delete activeNodeIdByRunId[RUN_SESSION_REPLAY_SNAPSHOT_KEY];
  internal = {
    ...internal,
    replaySourceLabel: null,
    replayLines: [],
    outputSnapshotsByRunId,
    activeNodeIdByRunId,
  };
  emit();
}

export function runSessionClearOutputSnapshotsForRun(runId: string): void {
  const rid = runId.trim();
  if (rid === "") {
    return;
  }
  const { [rid]: _, ...rest } = internal.outputSnapshotsByRunId;
  internal = { ...internal, outputSnapshotsByRunId: rest };
  emit();
}

export function runSessionSetNodeOutputSnapshotForRun(
  runId: string,
  nodeId: string,
  snapshot: Record<string, unknown>,
): void {
  const rid = runId.trim();
  const nid = nodeId.trim();
  if (rid === "" || nid === "") {
    return;
  }
  const prevMap = internal.outputSnapshotsByRunId[rid] ?? {};
  const outputSnapshotsByRunId = {
    ...internal.outputSnapshotsByRunId,
    [rid]: { ...prevMap, [nid]: snapshot },
  };
  internal = { ...internal, outputSnapshotsByRunId };
  emit();
}

export function runSessionSetActiveNodeIdForRun(runId: string, nodeId: string | null): void {
  const rid = runId.trim();
  if (rid === "") {
    return;
  }
  const activeNodeIdByRunId = { ...internal.activeNodeIdByRunId };
  if (nodeId == null || nodeId.trim() === "") {
    delete activeNodeIdByRunId[rid];
  } else {
    activeNodeIdByRunId[rid] = nodeId.trim();
  }
  internal = { ...internal, activeNodeIdByRunId };
  emit();
}

export function runSessionClearActiveNodeForRun(runId: string): void {
  runSessionSetActiveNodeIdForRun(runId, null);
}

export function runSessionSetPythonBanner(msg: string | null): void {
  internal = { ...internal, pythonBanner: msg };
  emit();
}

export function runSessionSetLastExitCode(code: number | null): void {
  internal = { ...internal, lastExitCode: code };
  emit();
}

export function useRunSession(): RunSessionSnapshot {
  return useSyncExternalStore(subscribeRunSession, getRunSessionSnapshot, getRunSessionSnapshot);
}

export function runSessionResetForTest(): void {
  internal = {
    liveRunOrder: [],
    focusedRunId: null,
    consoleByRunId: {},
    pendingStarts: [],
    replaySourceLabel: null,
    replayLines: [],
    activeNodeIdByRunId: {},
    pythonBanner: null,
    lastExitCode: null,
    outputSnapshotsByRunId: {},
  };
  emit();
}

export function runSessionGetFocusedRunIdForSideEffects(): string | null {
  return internal.focusedRunId;
}
