// Copyright GraphCaster. All Rights Reserved.

import { useSyncExternalStore } from "react";

import type { GraphDocumentJson } from "../graph/types";
import { transitiveStepCacheDirtyNodeIds } from "../graph/stepCacheDirtyGraph";

type StepCacheDirtySnapshot = {
  ids: string[];
};

let snap: StepCacheDirtySnapshot = { ids: [] };

const listeners = new Set<() => void>();

function emitDirty(): void {
  for (const c of listeners) {
    c();
  }
}

export function subscribeStepCacheDirty(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

export function getStepCacheDirtySnapshot(): StepCacheDirtySnapshot {
  return snap;
}

export function addStepCacheDirtyId(nodeId: string): void {
  const id = nodeId.trim();
  if (id === "") {
    return;
  }
  if (snap.ids.includes(id)) {
    return;
  }
  snap = { ids: [...snap.ids, id] };
  emitDirty();
}

export function addStepCacheDirtyIds(nodeIds: readonly string[]): void {
  const appended: string[] = [];
  const seen = new Set(snap.ids);
  for (const raw of nodeIds) {
    const id = raw.trim();
    if (id === "" || seen.has(id)) {
      continue;
    }
    seen.add(id);
    appended.push(id);
  }
  if (appended.length === 0) {
    return;
  }
  snap = { ids: [...snap.ids, ...appended] };
  emitDirty();
}

export function markStepCacheDirtyTransitive(
  doc: GraphDocumentJson,
  seedIds: readonly string[],
): void {
  const ids = transitiveStepCacheDirtyNodeIds(doc, seedIds);
  addStepCacheDirtyIds(ids);
}

export function clearStepCacheDirtyIds(): void {
  if (snap.ids.length === 0) {
    return;
  }
  snap = { ids: [] };
  emitDirty();
}

export function consumeStepCacheDirtyCsvForRun(): string {
  const csv = snap.ids.join(",");
  if (snap.ids.length > 0) {
    snap = { ids: [] };
    emitDirty();
  }
  return csv;
}

export function useStepCacheDirtyCount(): number {
  return useSyncExternalStore(
    subscribeStepCacheDirty,
    () => getStepCacheDirtySnapshot().ids.length,
    () => getStepCacheDirtySnapshot().ids.length,
  );
}
