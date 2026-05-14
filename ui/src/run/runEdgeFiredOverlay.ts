// Copyright GraphCaster. All Rights Reserved.

/**
 * Transient "edge just fired" overlay: when a node finishes successfully, all outgoing
 * edges X -> Y are marked as recently transmitting data and auto-cleared after a short window.
 * Independent of `runEdgeOverlay` (which tracks the single last-traversed edge highlight).
 */

import { useSyncExternalStore } from "react";

export const EDGE_FIRED_WINDOW_MS = 1200;

type Timer = ReturnType<typeof setTimeout>;

type FiredState = {
  edges: ReadonlySet<string>;
  revision: number;
};

const EMPTY_SET: ReadonlySet<string> = new Set<string>();

let state: FiredState = { edges: EMPTY_SET, revision: 0 };

const timers = new Map<string, Timer>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) {
    l();
  }
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function getSnapshot(): FiredState {
  return state;
}

function setState(next: FiredState): void {
  state = next;
  emit();
}

/** Mark a single edge as "just fired"; auto-clears after `windowMs`. */
export function runEdgeMarkFired(edgeId: string, windowMs: number = EDGE_FIRED_WINDOW_MS): void {
  const eid = edgeId.trim();
  if (eid === "") {
    return;
  }
  const prev = timers.get(eid);
  if (prev != null) {
    clearTimeout(prev);
  }
  if (!state.edges.has(eid)) {
    const nextEdges = new Set(state.edges);
    nextEdges.add(eid);
    setState({ edges: nextEdges, revision: state.revision + 1 });
  }
  const t = setTimeout(() => {
    timers.delete(eid);
    if (!state.edges.has(eid)) {
      return;
    }
    const nextEdges = new Set(state.edges);
    nextEdges.delete(eid);
    setState({ edges: nextEdges, revision: state.revision + 1 });
  }, Math.max(0, windowMs));
  timers.set(eid, t);
}

/** Mark all outgoing edges from `sourceNodeId` as fired (used on node success). */
export function runEdgeMarkFiredFromNode(
  sourceNodeId: string,
  allEdges: ReadonlyArray<{ id: string; source: string }>,
  windowMs: number = EDGE_FIRED_WINDOW_MS,
): void {
  const sid = sourceNodeId.trim();
  if (sid === "") {
    return;
  }
  for (const e of allEdges) {
    if (e.source === sid) {
      runEdgeMarkFired(e.id, windowMs);
    }
  }
}

/** Synchronous read of the current set; used by `toReactFlow` callers. */
export function getCurrentRunningEdges(): ReadonlySet<string> {
  return state.edges;
}

export function runEdgeFiredOverlayResetForTest(): void {
  for (const t of timers.values()) {
    clearTimeout(t);
  }
  timers.clear();
  state = { edges: EMPTY_SET, revision: 0 };
}

export function useCurrentRunningEdges(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshot().edges,
    () => getSnapshot().edges,
  );
}

export function useCurrentRunningEdgesRevision(): number {
  return useSyncExternalStore(
    subscribe,
    () => getSnapshot().revision,
    () => getSnapshot().revision,
  );
}

/**
 * Registered lookup for outgoing edges of a node id; the canvas wires this so run-event side effects
 * can mark outgoing edges as fired without depending on a specific graph document instance.
 */
type OutgoingEdgesProvider = (sourceNodeId: string) => ReadonlyArray<{ id: string; source: string }>;

let outgoingProvider: OutgoingEdgesProvider | null = null;

export function registerOutgoingEdgesProvider(p: OutgoingEdgesProvider | null): void {
  outgoingProvider = p;
}

/** Side-effect hook for parsed run events. Fires outgoing edges on successful node completion. */
export function applyParsedRunEventToFiredEdges(
  o: Record<string, unknown>,
  windowMs: number = EDGE_FIRED_WINDOW_MS,
): void {
  const t = o.type;
  if (typeof t !== "string") {
    return;
  }
  if (t !== "node_exit" && t !== "node_pinned_skip") {
    return;
  }
  const nidRaw = o.nodeId;
  if (typeof nidRaw !== "string") {
    return;
  }
  const nid = nidRaw.trim();
  if (nid === "" || outgoingProvider == null) {
    return;
  }
  const edges = outgoingProvider(nid);
  if (edges.length === 0) {
    return;
  }
  runEdgeMarkFiredFromNode(nid, edges, windowMs);
}
