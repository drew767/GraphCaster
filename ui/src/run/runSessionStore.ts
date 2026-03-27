// Copyright GraphCaster. All Rights Reserved.

import { useSyncExternalStore } from "react";

const MAX_LINES = 2000;

export type RunSessionSnapshot = {
  consoleLines: string[];
  activeRunId: string | null;
  activeNodeId: string | null;
  pythonBanner: string | null;
  lastExitCode: number | null;
};

let snap: RunSessionSnapshot = {
  consoleLines: [],
  activeRunId: null,
  activeNodeId: null,
  pythonBanner: null,
  lastExitCode: null,
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
  snap = { ...snap, consoleLines: [] };
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
