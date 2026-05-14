// Copyright GraphCaster. All Rights Reserved.

/**
 * Builds a per-node step tree from a flat NDJSON run event array.
 * Pure function — no store side effects.
 */

export type NodeStepStatus = "running" | "done" | "error" | "cached" | "cancelled";

export interface NodeStep {
  nodeId: string;
  type: string | null;
  status: NodeStepStatus;
  startedAt: number;
  endedAt: number | null;
  durationMs: number | null;
  inputs: unknown;
  outputs: unknown;
  error?: { message: string; stack?: string };
  llm?: { provider: string; model: string; tokens: number; costUsd: number };
  iterations?: NodeStep[];
  rawEvents: RunEvent[];
}

export type RunEvent = Record<string, unknown>;

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function parseTs(o: RunEvent): number {
  for (const key of ["ts", "at", "timestamp", "time"]) {
    const v = o[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const n = Date.parse(v);
      if (!Number.isNaN(n)) return n;
    }
  }
  return Date.now();
}

/** Group events by node_id, ordered by first appearance. */
export function buildTraceTree(events: RunEvent[]): NodeStep[] {
  const orderMap = new Map<string, number>();
  const buckets = new Map<string, RunEvent[]>();

  for (const ev of events) {
    const type = str(ev.type);
    if (type == null) continue;

    const nodeId =
      str(ev.nodeId) ??
      str(ev.parentNodeId) ??
      (type === "branch_skipped" ? str(ev.fromNode) : null);

    if (nodeId == null) continue;

    if (!buckets.has(nodeId)) {
      orderMap.set(nodeId, orderMap.size);
      buckets.set(nodeId, []);
    }
    buckets.get(nodeId)!.push(ev);
  }

  const steps: NodeStep[] = [];
  for (const [nodeId, evs] of buckets) {
    steps.push(buildNodeStep(nodeId, evs));
  }

  steps.sort((a, b) => {
    const oa = orderMap.get(a.nodeId) ?? 0;
    const ob = orderMap.get(b.nodeId) ?? 0;
    return oa - ob;
  });

  return steps;
}

function buildNodeStep(nodeId: string, evs: RunEvent[]): NodeStep {
  let type: string | null = null;
  let status: NodeStepStatus = "running";
  let startedAt = 0;
  let endedAt: number | null = null;
  let inputs: unknown = null;
  let outputs: unknown = null;
  let error: { message: string; stack?: string } | undefined;
  let llm: NodeStep["llm"] | undefined;
  const iterations: NodeStep[] = [];

  let firstTs: number | null = null;
  let lastTs: number | null = null;

  for (const ev of evs) {
    const evType = str(ev.type);
    const ts = parseTs(ev);

    if (firstTs == null) firstTs = ts;
    lastTs = ts;

    if (evType === "node_enter" || evType === "node_execute") {
      if (type == null) type = str(ev.nodeType);
      startedAt = ts;
    }

    if (evType === "node_visit" && inputs == null) {
      inputs = ev.upstream_outputs ?? ev.inputs ?? null;
    }

    if (evType === "node_exit") {
      outputs = ev.outputs ?? ev.result ?? null;
      status = "done";
      endedAt = ts;
    }

    if (evType === "node_pinned_skip") {
      status = "cached";
      endedAt = ts;
      outputs = ev.outputs ?? null;
    }

    if (evType === "process_complete") {
      const cancelled = ev.cancelled === true;
      const timedOut = ev.timedOut === true;
      const success = ev.success !== false && !cancelled && !timedOut;
      if (!success) {
        status = cancelled ? "cancelled" : "error";
      } else if (status !== "done" && status !== "cached") {
        status = "done";
      }
      endedAt = ts;
      if (ev.outputs != null) outputs = ev.outputs;
    }

    if (evType === "process_failed" || evType === "error") {
      status = "error";
      endedAt = ts;
      const msg = str(ev.message) ?? str(ev.error) ?? "Unknown error";
      const stack = typeof ev.stack === "string" ? ev.stack : undefined;
      error = { message: msg, stack };
    }

    if (evType === "branch_skipped") {
      status = "cancelled";
      endedAt = ts;
    }

    if (
      evType === "process_output" ||
      evType === "agent_step" ||
      evType === "agent_tool_call"
    ) {
      if (status === "running") {
        // keep running
      }
    }

    if (evType === "llm_token_usage" || evType === "llm_usage") {
      const provider = str(ev.provider) ?? "unknown";
      const model = str(ev.model) ?? "unknown";
      const tokens = typeof ev.totalTokens === "number" ? ev.totalTokens
        : (typeof ev.promptTokens === "number" ? ev.promptTokens : 0)
          + (typeof ev.completionTokens === "number" ? ev.completionTokens : 0);
      const costUsd = typeof ev.costUsd === "number" ? ev.costUsd : 0;
      llm = { provider, model, tokens, costUsd };
    }
  }

  if (firstTs != null && startedAt === 0) startedAt = firstTs;

  const durationMs =
    endedAt != null && startedAt > 0 ? endedAt - startedAt : null;

  return {
    nodeId,
    type,
    status,
    startedAt,
    endedAt,
    durationMs,
    inputs,
    outputs,
    error,
    llm,
    iterations: iterations.length > 0 ? iterations : undefined,
    rawEvents: evs,
  };
}
