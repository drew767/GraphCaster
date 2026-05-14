// Copyright GraphCaster. All Rights Reserved.

/**
 * F73: muted / bypassed / pinned node state fields stored inside node `data`.
 * These are frontend-only affordances; the backend will pick them up from persisted JSON.
 */
export type NodeState = {
  muted?: boolean;
  bypassed?: boolean;
  pinned?: boolean;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

export function readNodeState(data: Record<string, unknown>): NodeState {
  return {
    muted: data.muted === true,
    bypassed: data.bypassed === true,
    pinned: data.pinned === true,
  };
}

export function toggleNodeStateMuted(data: Record<string, unknown>): Record<string, unknown> {
  const out = { ...data };
  if (out.muted === true) {
    delete out.muted;
  } else {
    out.muted = true;
  }
  return out;
}

export function toggleNodeStateBypassed(data: Record<string, unknown>): Record<string, unknown> {
  const out = { ...data };
  if (out.bypassed === true) {
    delete out.bypassed;
  } else {
    out.bypassed = true;
  }
  return out;
}

export function toggleNodeStatePinned(data: Record<string, unknown>): Record<string, unknown> {
  const out = { ...data };
  if (out.pinned === true) {
    delete out.pinned;
  } else {
    out.pinned = true;
  }
  return out;
}

/** Apply a state toggle to a batch of nodes in a graph document node list. */
export function applyNodeStateToggle(
  nodes: Array<{ id: string; data?: Record<string, unknown> }>,
  nodeIds: ReadonlySet<string>,
  toggle: "muted" | "bypassed" | "pinned",
): Array<{ id: string; data?: Record<string, unknown> }> {
  const toggleFn =
    toggle === "muted"
      ? toggleNodeStateMuted
      : toggle === "bypassed"
        ? toggleNodeStateBypassed
        : toggleNodeStatePinned;
  return nodes.map((n) => {
    if (!nodeIds.has(n.id)) {
      return n;
    }
    const raw = isPlainObject(n.data) ? n.data : {};
    return { ...n, data: toggleFn(raw) };
  });
}

/** Count muted and bypassed nodes in a node list (for the run banner). */
export function countNodeStates(
  nodes: ReadonlyArray<{ data?: Record<string, unknown> }>,
): { muted: number; bypassed: number } {
  let muted = 0;
  let bypassed = 0;
  for (const n of nodes) {
    if (!isPlainObject(n.data)) {
      continue;
    }
    if (n.data.muted === true) {
      muted++;
    }
    if (n.data.bypassed === true) {
      bypassed++;
    }
  }
  return { muted, bypassed };
}
