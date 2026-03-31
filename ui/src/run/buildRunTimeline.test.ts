// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import {
  assignTimelineLanes,
  maxTimelineDurationMs,
  reduceConsoleLinesToRunTimeline,
} from "./buildRunTimeline";

describe("reduceConsoleLinesToRunTimeline", () => {
  it("two nodes sequential with run_finished closing last step", () => {
    const lines = [
      '{"type":"run_started","runId":"r1","rootGraphId":"g"}',
      '{"type":"node_enter","nodeId":"n1","nodeType":"task","graphId":"g"}',
      '{"type":"process_complete","nodeId":"n1","graphId":"g","exitCode":0,"timedOut":false,"attempt":0,"success":true}',
      '{"type":"node_enter","nodeId":"n2","nodeType":"exit","graphId":"g"}',
      '{"type":"run_finished","runId":"r1","rootGraphId":"g","status":"success"}',
    ];
    const rows = reduceConsoleLinesToRunTimeline(lines);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.nodeId).toBe("n1");
    expect(rows[0]?.status).toBe("success");
    expect(rows[1]?.nodeId).toBe("n2");
    expect(rows[1]?.status).toBe("success");
  });

  it("run_success closes exit node without run_finished", () => {
    const lines = [
      '{"type":"node_enter","nodeId":"only","nodeType":"task","graphId":"g"}',
      '{"type":"process_complete","nodeId":"only","graphId":"g","exitCode":0,"timedOut":false,"attempt":0,"success":true}',
      '{"type":"node_enter","nodeId":"ex","nodeType":"exit","graphId":"g"}',
      '{"type":"run_success","nodeId":"ex","graphId":"g"}',
    ];
    const rows = reduceConsoleLinesToRunTimeline(lines);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.status).toBe("success");
    expect(rows[1]?.nodeId).toBe("ex");
  });

  it("process_output storm does not add rows", () => {
    const lines = [
      '{"type":"node_enter","nodeId":"t","nodeType":"task","graphId":"g"}',
      '{"type":"process_output","runId":"r","nodeId":"t","graphId":"g","stream":"stdout","text":"a","seq":1}',
      '{"type":"process_output","runId":"r","nodeId":"t","graphId":"g","stream":"stdout","text":"b","seq":2}',
      '{"type":"process_complete","nodeId":"t","graphId":"g","exitCode":0,"timedOut":false,"attempt":0,"success":true}',
    ];
    const rows = reduceConsoleLinesToRunTimeline(lines);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.nodeId).toBe("t");
  });

  it("run_finished failed marks dangling step as failed", () => {
    const lines = [
      '{"type":"node_enter","nodeId":"hang","nodeType":"task","graphId":"g"}',
      '{"type":"run_finished","runId":"r1","rootGraphId":"g","status":"failed"}',
    ];
    const rows = reduceConsoleLinesToRunTimeline(lines);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("failed");
  });

  it("run_finished cancelled marks dangling step as cancelled", () => {
    const lines = [
      '{"type":"node_enter","nodeId":"c1","nodeType":"task","graphId":"g"}',
      '{"type":"run_finished","runId":"r1","rootGraphId":"g","status":"cancelled"}',
    ];
    expect(reduceConsoleLinesToRunTimeline(lines)[0]?.status).toBe("cancelled");
  });

  it("run_finished partial marks dangling step as partial", () => {
    const lines = [
      '{"type":"node_enter","nodeId":"p1","nodeType":"task","graphId":"g"}',
      '{"type":"run_finished","runId":"r1","rootGraphId":"g","status":"partial"}',
    ];
    expect(reduceConsoleLinesToRunTimeline(lines)[0]?.status).toBe("partial");
  });

  it("run_finished unknown status treats dangling step as failed", () => {
    const lines = [
      '{"type":"node_enter","nodeId":"u1","nodeType":"task","graphId":"g"}',
      '{"type":"run_finished","runId":"r1","rootGraphId":"g","status":"weird"}',
    ];
    expect(reduceConsoleLinesToRunTimeline(lines)[0]?.status).toBe("failed");
  });

  it("run_end marks dangling step as failed", () => {
    const lines = [
      '{"type":"node_enter","nodeId":"x","nodeType":"task","graphId":"g"}',
      '{"type":"run_end","reason":"cancel_requested"}',
    ];
    expect(reduceConsoleLinesToRunTimeline(lines)[0]?.status).toBe("failed");
  });

  it("idempotent for same input", () => {
    const lines = [
      '{"type":"node_enter","nodeId":"a","nodeType":"start","graphId":"g"}',
      '{"type":"node_enter","nodeId":"b","nodeType":"task","graphId":"g"}',
      '{"type":"process_complete","nodeId":"b","graphId":"g","exitCode":0,"timedOut":false,"attempt":0,"success":true}',
    ];
    const a = reduceConsoleLinesToRunTimeline(lines);
    const b = reduceConsoleLinesToRunTimeline(lines);
    expect(a).toEqual(b);
  });

  it("branch_skipped adds skipped row", () => {
    const lines = [
      '{"type":"branch_skipped","edgeId":"e1","fromNode":"fromN","toNode":"toN","graphId":"g","reason":"condition_false"}',
    ];
    const rows = reduceConsoleLinesToRunTimeline(lines);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("skipped");
    expect(rows[0]?.nodeId).toBe("fromN");
    expect(rows[0]?.summary).toBe("condition_false");
  });

  it("stderr-prefixed JSON still parses", () => {
    const lines = [
      '[stderr] {"type":"node_enter","nodeId":"s","nodeType":"task","graphId":"g"}',
      '{"type":"process_complete","nodeId":"s","graphId":"g","exitCode":0,"timedOut":false,"attempt":0,"success":true}',
    ];
    expect(reduceConsoleLinesToRunTimeline(lines)).toHaveLength(1);
    expect(reduceConsoleLinesToRunTimeline(lines)[0]?.status).toBe("success");
  });

  it("agent_step appends summary for current running node", () => {
    const lines = [
      '{"type":"node_enter","nodeId":"ag","nodeType":"llm_agent","graphId":"g"}',
      '{"type":"agent_step","nodeId":"ag","phase":"think","message":"hello"}',
      '{"type":"process_complete","nodeId":"ag","graphId":"g","exitCode":0,"timedOut":false,"attempt":0,"success":true}',
    ];
    const rows = reduceConsoleLinesToRunTimeline(lines);
    expect(rows[0]?.summary).toContain("think");
    expect(rows[0]?.summary).toContain("hello");
  });

  it("repeated node_enter same nodeId increments id", () => {
    const lines = [
      '{"type":"node_enter","nodeId":"loop","nodeType":"task","graphId":"g"}',
      '{"type":"process_complete","nodeId":"loop","graphId":"g","exitCode":0,"timedOut":false,"attempt":0,"success":true}',
      '{"type":"node_enter","nodeId":"loop","nodeType":"task","graphId":"g"}',
      '{"type":"process_complete","nodeId":"loop","graphId":"g","exitCode":0,"timedOut":false,"attempt":0,"success":true}',
    ];
    const rows = reduceConsoleLinesToRunTimeline(lines);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.id).toBe("loop-1");
    expect(rows[1]?.id).toBe("loop-2");
  });

  it("process_failed closes running row", () => {
    const lines = [
      '{"type":"node_enter","nodeId":"bad","nodeType":"task","graphId":"g"}',
      '{"type":"process_failed","nodeId":"bad","graphId":"g","reason":"spawn_error","message":"nope","attempt":0}',
    ];
    const rows = reduceConsoleLinesToRunTimeline(lines);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("failed");
  });
});

describe("maxTimelineDurationMs / assignTimelineLanes", () => {
  it("maxTimelineDurationMs picks largest duration", () => {
    expect(
      maxTimelineDurationMs([
        {
          id: "a",
          nodeId: "a",
          nodeType: null,
          status: "success",
          startedLineIndex: 0,
          durationMs: 10,
        },
        {
          id: "b",
          nodeId: "b",
          nodeType: null,
          status: "success",
          startedLineIndex: 1,
          durationMs: 40,
        },
      ]),
    ).toBe(40);
  });

  it("assignTimelineLanes staggers overlapping line intervals", () => {
    const rows = [
      {
        id: "1",
        nodeId: "a",
        nodeType: "task",
        status: "success" as const,
        startedLineIndex: 0,
        endedLineIndex: 2,
      },
      {
        id: "2",
        nodeId: "b",
        nodeType: "task",
        status: "success" as const,
        startedLineIndex: 1,
        endedLineIndex: 3,
      },
    ];
    expect(assignTimelineLanes(rows)).toEqual([0, 1]);
  });
});
