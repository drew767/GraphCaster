// Copyright GraphCaster. All Rights Reserved.

/**
 * Highlights the last traversed edge during a run (edge_traverse / branch_taken),
 * similar to React Flow animated edges + n8n-style active connection feedback.
 */

export type EdgeRunOverlayState = Readonly<{
  highlightedEdgeId: string | null;
}>;

const INITIAL: EdgeRunOverlayState = Object.freeze({
  highlightedEdgeId: null,
});

export function initialEdgeRunOverlay(): EdgeRunOverlayState {
  return INITIAL;
}

export function edgeRunOverlayStatesEqual(a: EdgeRunOverlayState, b: EdgeRunOverlayState): boolean {
  return a.highlightedEdgeId === b.highlightedEdgeId;
}

function str(v: unknown): string | null {
  if (typeof v !== "string") {
    return null;
  }
  const t = v.trim();
  return t === "" ? null : t;
}

export function applyParsedRunEventToEdgeRunOverlay(
  prev: EdgeRunOverlayState,
  o: Record<string, unknown>,
): EdgeRunOverlayState {
  const t = o.type;
  if (typeof t !== "string") {
    return prev;
  }

  if (t === "run_started") {
    if (prev.highlightedEdgeId == null) {
      return prev;
    }
    return { highlightedEdgeId: null };
  }

  if (t === "edge_traverse" || t === "branch_taken") {
    const eid = str(o.edgeId);
    if (eid == null) {
      return prev;
    }
    if (prev.highlightedEdgeId === eid) {
      return prev;
    }
    return { highlightedEdgeId: eid };
  }

  if (t === "run_finished" || t === "run_end" || t === "run_success") {
    if (prev.highlightedEdgeId == null) {
      return prev;
    }
    return { highlightedEdgeId: null };
  }

  return prev;
}
