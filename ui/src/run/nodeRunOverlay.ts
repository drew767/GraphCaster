// Copyright GraphCaster. All Rights Reserved.

/**
 * Projects NDJSON run events (see `schemas/run-event.schema.json`) onto per-node UI phases.
 * v1: no `pending` on untouched nodes; only nodes mentioned in the event stream get an overlay.
 * `nested_graph_exit` is ignored here: `runner.py` emits it before `error` on child failure; final
 * `graph_ref` state comes from `node_exit` / `process_*` / `error` on the parent node id.
 */

export type NodeRunPhase = "running" | "success" | "failed" | "skipped";

export type NodeRunOverlayEntry = {
  phase: NodeRunPhase;
  lastType?: string;
};

export type NodeRunOverlayState = Readonly<Record<string, NodeRunOverlayEntry>>;

/** Structural equality for overlay maps (phase + lastType per id). Used to skip full node-array churn in the canvas. */
export function nodeRunOverlayMapsEqual(
  a: Readonly<Record<string, NodeRunOverlayEntry>> | undefined | null,
  b: Readonly<Record<string, NodeRunOverlayEntry>> | undefined | null,
): boolean {
  if (a === b) {
    return true;
  }
  const ea = a ?? {};
  const eb = b ?? {};
  const ka = Object.keys(ea);
  const kb = Object.keys(eb);
  if (ka.length !== kb.length) {
    return false;
  }
  for (const k of ka) {
    const x = ea[k];
    const y = eb[k];
    if (y == null || x.phase !== y.phase || x.lastType !== y.lastType) {
      return false;
    }
  }
  return true;
}

function str(v: unknown): string | null {
  if (typeof v !== "string") {
    return null;
  }
  const t = v.trim();
  return t === "" ? null : t;
}

function setPhase(
  prev: NodeRunOverlayState,
  nodeId: string,
  phase: NodeRunPhase,
  lastType: string,
): NodeRunOverlayState {
  const cur = prev[nodeId];
  if (cur != null && cur.phase === phase && cur.lastType === lastType) {
    return prev;
  }
  return { ...prev, [nodeId]: { phase, lastType } };
}

function markFailed(prev: NodeRunOverlayState, nodeId: string, lastType: string): NodeRunOverlayState {
  return setPhase(prev, nodeId, "failed", lastType);
}

function markSuccess(prev: NodeRunOverlayState, nodeId: string, lastType: string): NodeRunOverlayState {
  const cur = prev[nodeId];
  if (cur?.phase === "failed") {
    return prev;
  }
  return setPhase(prev, nodeId, "success", lastType);
}

function markRunning(prev: NodeRunOverlayState, nodeId: string, lastType: string): NodeRunOverlayState {
  const cur = prev[nodeId];
  if (cur?.phase === "failed") {
    return prev;
  }
  return setPhase(prev, nodeId, "running", lastType);
}

function markSkipped(prev: NodeRunOverlayState, nodeId: string, lastType: string): NodeRunOverlayState {
  const cur = prev[nodeId];
  if (cur?.phase === "failed" || cur?.phase === "success") {
    return prev;
  }
  return setPhase(prev, nodeId, "skipped", lastType);
}

function processCompleteFailed(o: Record<string, unknown>): boolean {
  if (o.timedOut === true) {
    return true;
  }
  if (o.cancelled === true) {
    return true;
  }
  if (o.success === false) {
    return true;
  }
  if (typeof o.exitCode === "number" && o.exitCode !== 0) {
    return true;
  }
  return false;
}

export function applyParsedRunEventToOverlayState(
  prev: NodeRunOverlayState,
  o: Record<string, unknown>,
): NodeRunOverlayState {
  const t = o.type;
  if (typeof t !== "string") {
    return prev;
  }

  let next = prev;

  if (t === "node_enter" || t === "node_execute") {
    const nid = str(o.nodeId);
    if (nid != null) {
      next = markRunning(next, nid, t);
    }
    return next;
  }

  if (t === "node_pinned_skip") {
    const nid = str(o.nodeId);
    if (nid != null) {
      next = markSuccess(next, nid, t);
    }
    return next;
  }

  if (t === "node_exit") {
    const nid = str(o.nodeId);
    if (nid != null) {
      next = markSuccess(next, nid, t);
    }
    return next;
  }

  if (t === "process_complete") {
    const nid = str(o.nodeId);
    if (nid != null && processCompleteFailed(o)) {
      next = markFailed(next, nid, t);
    }
    return next;
  }

  if (t === "process_failed") {
    const nid = str(o.nodeId);
    if (nid != null) {
      next = markFailed(next, nid, t);
    }
    return next;
  }

  if (t === "error") {
    const nid = str(o.nodeId);
    if (nid != null) {
      next = markFailed(next, nid, t);
    }
    return next;
  }

  if (t === "branch_skipped") {
    const to = str(o.toNode);
    if (to != null) {
      next = markSkipped(next, to, t);
    }
    return next;
  }

  if (t === "nested_graph_enter") {
    const pid = str(o.parentNodeId);
    if (pid != null) {
      next = markRunning(next, pid, t);
    }
    return next;
  }

  if (t === "nested_graph_exit") {
    return next;
  }

  if (
    t === "ai_route_failed" ||
    t === "mcp_tool_failed" ||
    t === "agent_failed"
  ) {
    const nid = str(o.nodeId);
    if (nid != null) {
      next = markFailed(next, nid, t);
    }
    return next;
  }

  if (t === "run_success") {
    const nid = str(o.nodeId);
    if (nid != null) {
      next = markSuccess(next, nid, t);
    }
    return next;
  }

  if (
    t === "agent_delegate_start" ||
    t === "agent_step" ||
    t === "agent_tool_call"
  ) {
    const nid = str(o.nodeId);
    if (nid != null) {
      next = markRunning(next, nid, t);
    }
    return next;
  }

  if (t === "process_retry") {
    const nid = str(o.nodeId);
    if (nid != null) {
      next = markRunning(next, nid, t);
    }
    return next;
  }

  return prev;
}

export function reduceRunEventsToNodeOverlay(events: readonly unknown[]): NodeRunOverlayState {
  let acc: NodeRunOverlayState = {};
  for (const ev of events) {
    if (ev == null || typeof ev !== "object" || Array.isArray(ev)) {
      continue;
    }
    acc = applyParsedRunEventToOverlayState(acc, ev as Record<string, unknown>);
  }
  return acc;
}
