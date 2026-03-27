// Copyright GraphCaster. All Rights Reserved.

import type { GraphDocumentJson } from "./types";

export type DocumentHistoryState = {
  past: GraphDocumentJson[];
  future: GraphDocumentJson[];
  maxDepth: number;
};

function cloneDoc(doc: GraphDocumentJson): GraphDocumentJson {
  return structuredClone(doc) as GraphDocumentJson;
}

function docSignature(doc: GraphDocumentJson): string {
  return JSON.stringify(doc);
}

export function documentJsonSignature(doc: GraphDocumentJson): string {
  return docSignature(doc);
}

export function createEmptyHistory(maxDepth: number): DocumentHistoryState {
  return { past: [], future: [], maxDepth: Math.max(1, maxDepth) };
}

export function clearHistory(state: DocumentHistoryState): DocumentHistoryState {
  return { ...state, past: [], future: [] };
}

export function snapshotBeforeChange(
  state: DocumentHistoryState,
  current: GraphDocumentJson,
): DocumentHistoryState {
  const snap = cloneDoc(current);
  const last = state.past[state.past.length - 1];
  if (last !== undefined && docSignature(last) === docSignature(snap)) {
    return { ...state, future: [] };
  }
  let past = [...state.past, snap];
  if (past.length > state.maxDepth) {
    past = past.slice(-state.maxDepth);
  }
  return { ...state, past, future: [] };
}

export function undoDocument(
  state: DocumentHistoryState,
  current: GraphDocumentJson,
): { document: GraphDocumentJson; nextHistory: DocumentHistoryState } | null {
  if (state.past.length === 0) {
    return null;
  }
  const past = [...state.past];
  const previous = past.pop();
  if (previous === undefined) {
    return null;
  }
  const currentClone = cloneDoc(current);
  const nextHistory: DocumentHistoryState = {
    ...state,
    past,
    future: [currentClone, ...state.future],
  };
  return { document: cloneDoc(previous), nextHistory };
}

export function redoDocument(
  state: DocumentHistoryState,
  current: GraphDocumentJson,
): { document: GraphDocumentJson; nextHistory: DocumentHistoryState } | null {
  if (state.future.length === 0) {
    return null;
  }
  const future = [...state.future];
  const next = future.shift();
  if (next === undefined) {
    return null;
  }
  const currentClone = cloneDoc(current);
  const nextHistory: DocumentHistoryState = {
    ...state,
    past: [...state.past, currentClone],
    future,
  };
  return { document: cloneDoc(next), nextHistory };
}
