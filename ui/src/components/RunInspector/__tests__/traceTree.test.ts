// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect } from "vitest";
import { buildTraceTree, type RunEvent } from "../traceTree";

const T0 = 1_700_000_000_000;

function ev(type: string, extra: Record<string, unknown> = {}): RunEvent {
  return { type, ts: T0 + Object.keys(extra).length, ...extra };
}

describe("buildTraceTree", () => {
  it("returns empty array for empty events", () => {
    expect(buildTraceTree([])).toEqual([]);
  });

  it("builds a single node step from enter/exit events", () => {
    const events: RunEvent[] = [
      { type: "node_enter", nodeId: "node-1", nodeType: "task", ts: T0 },
      { type: "node_exit", nodeId: "node-1", outputs: { result: 42 }, ts: T0 + 500 },
    ];
    const steps = buildTraceTree(events);
    expect(steps).toHaveLength(1);
    const step = steps[0]!;
    expect(step.nodeId).toBe("node-1");
    expect(step.type).toBe("task");
    expect(step.status).toBe("done");
    expect(step.outputs).toEqual({ result: 42 });
    expect(step.durationMs).toBe(500);
  });

  it("sets status error on error event", () => {
    const events: RunEvent[] = [
      { type: "node_enter", nodeId: "n1", nodeType: "task", ts: T0 },
      { type: "error", nodeId: "n1", message: "Something broke", ts: T0 + 100 },
    ];
    const steps = buildTraceTree(events);
    expect(steps[0]!.status).toBe("error");
    expect(steps[0]!.error?.message).toBe("Something broke");
  });

  it("sets status cached on node_pinned_skip", () => {
    const events: RunEvent[] = [
      { type: "node_pinned_skip", nodeId: "n2", outputs: { x: 1 }, ts: T0 },
    ];
    const steps = buildTraceTree(events);
    expect(steps[0]!.status).toBe("cached");
  });

  it("sets status cancelled on branch_skipped", () => {
    const events: RunEvent[] = [
      { type: "branch_skipped", fromNode: "n3", reason: "condition false", ts: T0 },
    ];
    const steps = buildTraceTree(events);
    expect(steps[0]!.status).toBe("cancelled");
    expect(steps[0]!.nodeId).toBe("n3");
  });

  it("orders steps by first appearance", () => {
    const events: RunEvent[] = [
      { type: "node_enter", nodeId: "a", nodeType: "task", ts: T0 },
      { type: "node_enter", nodeId: "b", nodeType: "task", ts: T0 + 100 },
      { type: "node_exit", nodeId: "a", ts: T0 + 200 },
      { type: "node_exit", nodeId: "b", ts: T0 + 300 },
    ];
    const steps = buildTraceTree(events);
    expect(steps.map((s) => s.nodeId)).toEqual(["a", "b"]);
  });

  it("aggregates LLM token usage", () => {
    const events: RunEvent[] = [
      { type: "node_enter", nodeId: "llm-1", nodeType: "llm_agent", ts: T0 },
      {
        type: "llm_token_usage",
        nodeId: "llm-1",
        provider: "openai",
        model: "gpt-4",
        totalTokens: 1200,
        costUsd: 0.036,
        ts: T0 + 200,
      },
      { type: "node_exit", nodeId: "llm-1", ts: T0 + 300 },
    ];
    const steps = buildTraceTree(events);
    expect(steps[0]!.llm).toEqual({
      provider: "openai",
      model: "gpt-4",
      tokens: 1200,
      costUsd: 0.036,
    });
  });

  it("captures inputs from node_visit event", () => {
    const events: RunEvent[] = [
      { type: "node_enter", nodeId: "n4", nodeType: "task", ts: T0 },
      {
        type: "node_visit",
        nodeId: "n4",
        upstream_outputs: { prev: "hello" },
        ts: T0 + 10,
      },
      { type: "node_exit", nodeId: "n4", outputs: { out: "world" }, ts: T0 + 50 },
    ];
    const steps = buildTraceTree(events);
    expect(steps[0]!.inputs).toEqual({ prev: "hello" });
    expect(steps[0]!.outputs).toEqual({ out: "world" });
  });

  it("ignores events without nodeId", () => {
    const events: RunEvent[] = [
      { type: "run_started", runId: "r1", ts: T0 },
      { type: "run_finished", status: "success", ts: T0 + 1000 },
    ];
    const steps = buildTraceTree(events);
    expect(steps).toHaveLength(0);
  });

  it("handles process_complete cancelled flag", () => {
    const events: RunEvent[] = [
      { type: "node_enter", nodeId: "n5", nodeType: "task", ts: T0 },
      {
        type: "process_complete",
        nodeId: "n5",
        cancelled: true,
        ts: T0 + 100,
      },
    ];
    const steps = buildTraceTree(events);
    expect(steps[0]!.status).toBe("cancelled");
  });

  it("preserves rawEvents on each step", () => {
    const events: RunEvent[] = [
      { type: "node_enter", nodeId: "x1", nodeType: "task", ts: T0 },
      { type: "node_exit", nodeId: "x1", ts: T0 + 100 },
    ];
    const steps = buildTraceTree(events);
    expect(steps[0]!.rawEvents).toHaveLength(2);
  });
});
