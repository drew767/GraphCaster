// Copyright GraphCaster. All Rights Reserved.

import { useSyncExternalStore } from "react";

import {
  applyParsedRunEventToEdgeRunOverlay,
  initialEdgeRunOverlay,
  type EdgeRunOverlayState,
} from "./runEdgeOverlay";
import { applyParsedRunEventToOverlayState, type NodeRunOverlayEntry } from "./nodeRunOverlay";

const MAX_LINES_PER_RUN = 2000;

const EMPTY_NODE_RUN_OVERLAY: Record<string, NodeRunOverlayEntry> = Object.freeze(
  {},
) as Record<string, NodeRunOverlayEntry>;

/** Final canvas overlay kept after the worker exits (n8n / Langflow style last-execution summary). */
export type SettledRunVisual = {
  nodeRunOverlay: Record<string, NodeRunOverlayEntry>;
  edgeRunOverlay: EdgeRunOverlayState;
  sourceRunId: string;
};

function shallowCloneNodeRunOverlay(
  m: Record<string, NodeRunOverlayEntry>,
): Record<string, NodeRunOverlayEntry> {
  const out: Record<string, NodeRunOverlayEntry> = {};
  for (const k of Object.keys(m)) {
    const e = m[k]!;
    out[k] = { phase: e.phase, lastType: e.lastType };
  }
  return out;
}

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
  nodeRunOverlayByNodeId: Readonly<Record<string, NodeRunOverlayEntry>>;
  /**
   * Incremented when the **visible** node-run overlay map or its source run/replay mode changes.
   * Lets `GraphCanvas` skip O(n) structural compares of overlay maps on unrelated store emits.
   */
  nodeRunOverlayRevision: number;
  /** Last traversed edge id for the visible run/replay (edge_traverse / branch_taken). */
  highlightedRunEdgeId: string | null;
  /** Bump when the visible run edge highlight changes; mirrors `nodeRunOverlayRevision` pattern. */
  edgeRunOverlayRevision: number;
  /** True when `settledVisualByRootGraphId` has an entry for the open graph (`currentRootGraphId`). */
  canClearSettledRunVisual: boolean;
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
  nodeRunOverlayByRunId: Record<string, Record<string, NodeRunOverlayEntry>>;
  nodeRunOverlayRevision: number;
  edgeRunOverlayByRunId: Record<string, EdgeRunOverlayState>;
  edgeRunOverlayRevision: number;
  /** Open document `meta.graphId` / root id — selects which settled snapshot is visible. */
  currentRootGraphId: string | null;
  /** Each `run_started` / `run_finished` may set `rootGraphId` for NDJSON runs. */
  rootGraphIdByRunId: Record<string, string>;
  /** Last traversed edge per run (survives `run_finished`, which clears the live edge highlight). */
  lastTraversedEdgeByRunId: Record<string, string>;
  settledVisualByRootGraphId: Record<string, SettledRunVisual>;
};

/**
 * When the worker process exits we drop per-run maps; copy overlays into this map keyed by root graph id.
 */
function captureSettledVisualForRunId(
  s: InternalState,
  rid: string,
): { rootGraphId: string; payload: SettledRunVisual } | null {
  const rootGraphId =
    s.rootGraphIdByRunId[rid]?.trim() || s.currentRootGraphId?.trim() || "";
  if (!rootGraphId) {
    return null;
  }
  const nodeSrc = s.nodeRunOverlayByRunId[rid] ?? {};
  const lastEdge = s.lastTraversedEdgeByRunId[rid] ?? null;
  return {
    rootGraphId,
    payload: {
      nodeRunOverlay: shallowCloneNodeRunOverlay(nodeSrc),
      edgeRunOverlay: { highlightedEdgeId: lastEdge },
      sourceRunId: rid,
    },
  };
}

function trimBuffer(lines: string[]): string[] {
  if (lines.length <= MAX_LINES_PER_RUN) {
    return lines;
  }
  return lines.slice(-MAX_LINES_PER_RUN);
}

function publicNodeRunOverlay(s: InternalState): Record<string, NodeRunOverlayEntry> {
  const replay = s.replaySourceLabel != null;
  if (replay) {
    return s.nodeRunOverlayByRunId[RUN_SESSION_REPLAY_SNAPSHOT_KEY] ?? EMPTY_NODE_RUN_OVERLAY;
  }
  if (s.focusedRunId != null) {
    return s.nodeRunOverlayByRunId[s.focusedRunId] ?? EMPTY_NODE_RUN_OVERLAY;
  }
  // No live focus: after all workers exit, show last settled summary for the open graph (if any).
  if (
    s.liveRunOrder.length === 0 &&
    s.currentRootGraphId != null &&
    s.currentRootGraphId !== ""
  ) {
    const settled = s.settledVisualByRootGraphId[s.currentRootGraphId];
    if (settled != null) {
      return settled.nodeRunOverlay;
    }
  }
  return EMPTY_NODE_RUN_OVERLAY;
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

function publicHighlightedRunEdgeId(s: InternalState): string | null {
  const replay = s.replaySourceLabel != null;
  if (replay) {
    return s.edgeRunOverlayByRunId[RUN_SESSION_REPLAY_SNAPSHOT_KEY]?.highlightedEdgeId ?? null;
  }
  if (s.focusedRunId != null) {
    return s.edgeRunOverlayByRunId[s.focusedRunId]?.highlightedEdgeId ?? null;
  }
  if (
    s.liveRunOrder.length === 0 &&
    s.currentRootGraphId != null &&
    s.currentRootGraphId !== ""
  ) {
    const settled = s.settledVisualByRootGraphId[s.currentRootGraphId];
    if (settled != null) {
      return settled.edgeRunOverlay.highlightedEdgeId ?? null;
    }
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
    nodeRunOverlayByNodeId: publicNodeRunOverlay(s),
    nodeRunOverlayRevision: s.nodeRunOverlayRevision,
    highlightedRunEdgeId: publicHighlightedRunEdgeId(s),
    edgeRunOverlayRevision: s.edgeRunOverlayRevision,
    canClearSettledRunVisual:
      s.currentRootGraphId != null &&
      s.currentRootGraphId !== "" &&
      s.settledVisualByRootGraphId[s.currentRootGraphId] != null,
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
  nodeRunOverlayByRunId: {},
  nodeRunOverlayRevision: 0,
  edgeRunOverlayByRunId: {},
  edgeRunOverlayRevision: 0,
  currentRootGraphId: null,
  rootGraphIdByRunId: {},
  lastTraversedEdgeByRunId: {},
  settledVisualByRootGraphId: {},
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
    internal = {
      ...internal,
      focusedRunId: rid,
      nodeRunOverlayRevision: internal.nodeRunOverlayRevision + 1,
      edgeRunOverlayRevision: internal.edgeRunOverlayRevision + 1,
    };
    emit();
    return;
  }
  let settledVisualByRootGraphId = internal.settledVisualByRootGraphId;
  const cg = internal.currentRootGraphId?.trim();
  if (cg && internal.settledVisualByRootGraphId[cg] != null) {
    const { [cg]: _rm, ...restSettled } = internal.settledVisualByRootGraphId;
    settledVisualByRootGraphId = restSettled;
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
    settledVisualByRootGraphId,
    nodeRunOverlayRevision: internal.nodeRunOverlayRevision + 1,
    edgeRunOverlayRevision: internal.edgeRunOverlayRevision + 1,
  };
  emit();
}

export function runSessionSetFocusedRunId(runId: string | null): void {
  if (runId == null) {
    internal = {
      ...internal,
      focusedRunId: null,
      nodeRunOverlayRevision: internal.nodeRunOverlayRevision + 1,
      edgeRunOverlayRevision: internal.edgeRunOverlayRevision + 1,
    };
    emit();
    return;
  }
  const rid = runId.trim();
  if (rid === "" || !internal.liveRunOrder.includes(rid)) {
    return;
  }
  internal = {
    ...internal,
    focusedRunId: rid,
    nodeRunOverlayRevision: internal.nodeRunOverlayRevision + 1,
    edgeRunOverlayRevision: internal.edgeRunOverlayRevision + 1,
  };
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
  const captured = captureSettledVisualForRunId(internal, rid);
  let settledVisualByRootGraphId = internal.settledVisualByRootGraphId;
  if (captured != null) {
    settledVisualByRootGraphId = {
      ...internal.settledVisualByRootGraphId,
      [captured.rootGraphId]: captured.payload,
    };
  }
  const prevFocus = internal.focusedRunId;
  const liveRunOrder = internal.liveRunOrder.filter((x) => x !== rid);
  const { [rid]: _c, ...restConsole } = internal.consoleByRunId;
  const { [rid]: _s, ...restSnaps } = internal.outputSnapshotsByRunId;
  const { [rid]: _a, ...restActive } = internal.activeNodeIdByRunId;
  const { [rid]: _o, ...restOverlay } = internal.nodeRunOverlayByRunId;
  const { [rid]: _e, ...restEdgeOverlay } = internal.edgeRunOverlayByRunId;
  const { [rid]: _rg, ...restRootGid } = internal.rootGraphIdByRunId;
  const { [rid]: _lt, ...restLastEdge } = internal.lastTraversedEdgeByRunId;
  const newFocus = pickFocusAfterRemove(liveRunOrder, prevFocus);
  const { pending, next } = takeNextPendingIfUnderCap(liveRunOrder.length);
  internal = {
    ...internal,
    liveRunOrder,
    focusedRunId: newFocus,
    consoleByRunId: restConsole,
    outputSnapshotsByRunId: restSnaps,
    activeNodeIdByRunId: restActive,
    nodeRunOverlayByRunId: restOverlay,
    edgeRunOverlayByRunId: restEdgeOverlay,
    rootGraphIdByRunId: restRootGid,
    lastTraversedEdgeByRunId: restLastEdge,
    settledVisualByRootGraphId,
    pendingStarts: pending,
    nodeRunOverlayRevision: internal.nodeRunOverlayRevision + 1,
    edgeRunOverlayRevision: internal.edgeRunOverlayRevision + 1,
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
  const captured = captureSettledVisualForRunId(internal, rid);
  let settledVisualByRootGraphId = internal.settledVisualByRootGraphId;
  if (captured != null) {
    settledVisualByRootGraphId = {
      ...internal.settledVisualByRootGraphId,
      [captured.rootGraphId]: captured.payload,
    };
  }
  const wasFocused = internal.focusedRunId === rid;
  const prevFocus = internal.focusedRunId;
  const liveRunOrder = internal.liveRunOrder.filter((x) => x !== rid);
  const { [rid]: _c, ...restConsole } = internal.consoleByRunId;
  const { [rid]: _s, ...restSnaps } = internal.outputSnapshotsByRunId;
  const { [rid]: _a, ...restActive } = internal.activeNodeIdByRunId;
  const { [rid]: _o, ...restOverlay } = internal.nodeRunOverlayByRunId;
  const { [rid]: _e, ...restEdgeOverlay } = internal.edgeRunOverlayByRunId;
  const { [rid]: _rg, ...restRootGid } = internal.rootGraphIdByRunId;
  const { [rid]: _lt, ...restLastEdge } = internal.lastTraversedEdgeByRunId;
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
    nodeRunOverlayByRunId: restOverlay,
    edgeRunOverlayByRunId: restEdgeOverlay,
    rootGraphIdByRunId: restRootGid,
    lastTraversedEdgeByRunId: restLastEdge,
    settledVisualByRootGraphId,
    pendingStarts: pending,
    lastExitCode: setExit ? code : internal.lastExitCode,
    nodeRunOverlayRevision: internal.nodeRunOverlayRevision + 1,
    edgeRunOverlayRevision: internal.edgeRunOverlayRevision + 1,
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
  const nodeRunOverlayByRunId = {
    ...internal.nodeRunOverlayByRunId,
    [RUN_SESSION_REPLAY_SNAPSHOT_KEY]: {},
  };
  const edgeRunOverlayByRunId = {
    ...internal.edgeRunOverlayByRunId,
    [RUN_SESSION_REPLAY_SNAPSHOT_KEY]: initialEdgeRunOverlay(),
  };
  internal = {
    ...internal,
    replaySourceLabel: sourceLabel,
    replayLines: [],
    outputSnapshotsByRunId,
    activeNodeIdByRunId,
    nodeRunOverlayByRunId,
    edgeRunOverlayByRunId,
    lastExitCode: null,
    nodeRunOverlayRevision: internal.nodeRunOverlayRevision + 1,
    edgeRunOverlayRevision: internal.edgeRunOverlayRevision + 1,
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
  const nodeRunOverlayByRunId = { ...internal.nodeRunOverlayByRunId };
  delete nodeRunOverlayByRunId[RUN_SESSION_REPLAY_SNAPSHOT_KEY];
  const edgeRunOverlayByRunId = { ...internal.edgeRunOverlayByRunId };
  delete edgeRunOverlayByRunId[RUN_SESSION_REPLAY_SNAPSHOT_KEY];
  internal = {
    ...internal,
    replaySourceLabel: null,
    replayLines: [],
    outputSnapshotsByRunId,
    activeNodeIdByRunId,
    nodeRunOverlayByRunId,
    edgeRunOverlayByRunId,
    nodeRunOverlayRevision: internal.nodeRunOverlayRevision + 1,
    edgeRunOverlayRevision: internal.edgeRunOverlayRevision + 1,
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
    nodeRunOverlayByRunId: {},
    nodeRunOverlayRevision: 0,
    edgeRunOverlayByRunId: {},
    edgeRunOverlayRevision: 0,
    currentRootGraphId: null,
    rootGraphIdByRunId: {},
    lastTraversedEdgeByRunId: {},
    settledVisualByRootGraphId: {},
  };
  emit();
}

/** Sync open document root id so settled snapshots apply to the correct graph. */
export function runSessionSetCurrentRootGraphId(graphId: string | null): void {
  const raw = graphId?.trim() ?? "";
  const normalized = raw === "" ? null : raw;
  if (internal.currentRootGraphId === normalized) {
    return;
  }
  internal = {
    ...internal,
    currentRootGraphId: normalized,
    nodeRunOverlayRevision: internal.nodeRunOverlayRevision + 1,
    edgeRunOverlayRevision: internal.edgeRunOverlayRevision + 1,
  };
  emit();
}

/**
 * NDJSON `run_started` / `run_finished` carry `rootGraphId`. Stored per run id for settlement when the worker exits.
 * Does not emit — not part of the public snapshot.
 */
export function runSessionNoteRootGraphForRun(runId: string, rootGraphId: string): void {
  const rid = runId.trim();
  const rg = rootGraphId.trim();
  if (rid === "" || rg === "") {
    return;
  }
  if (internal.rootGraphIdByRunId[rid] === rg) {
    return;
  }
  internal = {
    ...internal,
    rootGraphIdByRunId: { ...internal.rootGraphIdByRunId, [rid]: rg },
  };
}

/** Drop sticky execution overlay for the currently open graph (Run toolbar). */
export function runSessionClearSettledVisualForCurrentGraph(): void {
  const cg = internal.currentRootGraphId?.trim();
  if (!cg || internal.settledVisualByRootGraphId[cg] == null) {
    return;
  }
  const { [cg]: _rm, ...rest } = internal.settledVisualByRootGraphId;
  internal = {
    ...internal,
    settledVisualByRootGraphId: rest,
    nodeRunOverlayRevision: internal.nodeRunOverlayRevision + 1,
    edgeRunOverlayRevision: internal.edgeRunOverlayRevision + 1,
  };
  emit();
}

export function runSessionGetFocusedRunIdForSideEffects(): string | null {
  return internal.focusedRunId;
}

export function runSessionApplyParsedRunEventToOverlay(runKey: string, o: Record<string, unknown>): void {
  const key = runKey.trim();
  if (key === "") {
    return;
  }
  const t = o.type;
  let lastTraversedEdgeByRunId = internal.lastTraversedEdgeByRunId;
  if (typeof t === "string" && t === "run_started") {
    const { [key]: _d, ...restLt } = lastTraversedEdgeByRunId;
    lastTraversedEdgeByRunId = restLt;
  }
  const prevNode = internal.nodeRunOverlayByRunId[key] ?? {};
  const nextNode = applyParsedRunEventToOverlayState(prevNode, o);
  const prevEdge = internal.edgeRunOverlayByRunId[key] ?? initialEdgeRunOverlay();
  const nextEdge = applyParsedRunEventToEdgeRunOverlay(prevEdge, o);
  if (typeof t === "string" && (t === "edge_traverse" || t === "branch_taken")) {
    const eid = nextEdge.highlightedEdgeId;
    if (eid != null) {
      lastTraversedEdgeByRunId = { ...lastTraversedEdgeByRunId, [key]: eid };
    }
  }
  const ltChanged = lastTraversedEdgeByRunId !== internal.lastTraversedEdgeByRunId;
  if (nextNode === prevNode && nextEdge === prevEdge && !ltChanged) {
    return;
  }
  if (nextNode === prevNode && nextEdge === prevEdge && ltChanged) {
    internal = { ...internal, lastTraversedEdgeByRunId };
    return;
  }
  let nextInternal: InternalState = { ...internal, lastTraversedEdgeByRunId };
  if (nextNode !== prevNode) {
    nextInternal = {
      ...nextInternal,
      nodeRunOverlayByRunId: {
        ...nextInternal.nodeRunOverlayByRunId,
        [key]: { ...nextNode },
      },
      nodeRunOverlayRevision: nextInternal.nodeRunOverlayRevision + 1,
    };
  }
  if (nextEdge !== prevEdge) {
    nextInternal = {
      ...nextInternal,
      edgeRunOverlayByRunId: {
        ...nextInternal.edgeRunOverlayByRunId,
        [key]: nextEdge,
      },
      edgeRunOverlayRevision: nextInternal.edgeRunOverlayRevision + 1,
    };
  }
  internal = nextInternal;
  emit();
}
