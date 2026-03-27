// Copyright GraphCaster. All Rights Reserved.

import { useSyncExternalStore } from "react";

const MAX_LINES = 2000;

export type RunSessionSnapshot = {
  consoleLines: string[];
  activeRunId: string | null;
  activeNodeId: string | null;
  pythonBanner: string | null;
  lastExitCode: number | null;
  nodeOutputSnapshots: Record<string, Record<string, unknown>>;
  replaySourceLabel: string | null;
};

let snap: RunSessionSnapshot = {
  consoleLines: [],
  activeRunId: null,
  activeNodeId: null,
  pythonBanner: null,
  lastExitCode: null,
  nodeOutputSnapshots: {},
  replaySourceLabel: null,
};

const listeners = new Set<() => void>();

function emit(): void {
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
  return snap;
}

export function runSessionClearConsole(): void {
  snap = { ...snap, consoleLines: [], replaySourceLabel: null };
  emit();
}

export function runSessionBeginReplay(sourceLabel: string): void {
  snap = {
    ...snap,
    consoleLines: [],
    replaySourceLabel: sourceLabel,
    nodeOutputSnapshots: {},
    activeNodeId: null,
    lastExitCode: null,
  };
  emit();
}

export function runSessionClearReplay(): void {
  if (snap.replaySourceLabel == null) {
    return;
  }
  snap = { ...snap, replaySourceLabel: null };
  emit();
}

export function runSessionAppendLine(text: string): void {
  const next = [...snap.consoleLines, text];
  const trimmed = next.length > MAX_LINES ? next.slice(-MAX_LINES) : next;
  snap = { ...snap, consoleLines: trimmed };
  emit();
}

export function runSessionSetActiveRunId(id: string | null): void {
  snap = { ...snap, activeRunId: id };
  emit();
}

export function runSessionClearOutputSnapshots(): void {
  snap = { ...snap, nodeOutputSnapshots: {} };
  emit();
}

export function runSessionSetNodeOutputSnapshot(
  nodeId: string,
  snapshot: Record<string, unknown>,
): void {
  snap = {
    ...snap,
    nodeOutputSnapshots: { ...snap.nodeOutputSnapshots, [nodeId]: snapshot },
  };
  emit();
}

export function runSessionSetActiveNodeId(id: string | null): void {
  snap = { ...snap, activeNodeId: id };
  emit();
}

export function runSessionSetPythonBanner(msg: string | null): void {
  snap = { ...snap, pythonBanner: msg };
  emit();
}

export function runSessionSetLastExitCode(code: number | null): void {
  snap = { ...snap, lastExitCode: code };
  emit();
}

export function useRunSession(): RunSessionSnapshot {
  return useSyncExternalStore(subscribeRunSession, getRunSessionSnapshot, getRunSessionSnapshot);
}
