// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import { parseRunEventLine } from "./parseRunEventLine";
import { applyParsedRunEventToOverlayState, reduceRunEventsToNodeOverlay } from "./nodeRunOverlay";

function linesToEvents(lines: string[]): unknown[] {
  const out: unknown[] = [];
  for (const line of lines) {
    const v = parseRunEventLine(line);
    if (v != null) {
      out.push(v);
    }
  }
  return out;
}

describe("reduceRunEventsToNodeOverlay", () => {
  it("linear task: running then success after node_exit", () => {
    const ev = linesToEvents([
      '{"type":"node_enter","nodeId":"t1","nodeType":"task","graphId":"g"}',
      '{"type":"node_exit","nodeId":"t1","nodeType":"task","graphId":"g"}',
    ]);
    const s = reduceRunEventsToNodeOverlay(ev);
    expect(s.t1?.phase).toBe("success");
    expect(s.t1?.lastType).toBe("node_exit");
  });

  it("process_complete failure marks failed and node_exit does not clear it", () => {
    const ev = linesToEvents([
      '{"type":"node_enter","nodeId":"t1","nodeType":"task","graphId":"g"}',
      '{"type":"process_complete","nodeId":"t1","graphId":"g","exitCode":1,"timedOut":false,"attempt":0,"success":false}',
      '{"type":"node_exit","nodeId":"t1","nodeType":"task","graphId":"g"}',
    ]);
    const s = reduceRunEventsToNodeOverlay(ev);
    expect(s.t1?.phase).toBe("failed");
  });

  it("merge branch: one path taken, other target skipped", () => {
    const ev = linesToEvents([
      '{"type":"branch_skipped","edgeId":"e1","fromNode":"fork","toNode":"dead","graphId":"g","reason":"condition_false"}',
      '{"type":"node_enter","nodeId":"live","nodeType":"task","graphId":"g"}',
      '{"type":"node_exit","nodeId":"live","nodeType":"task","graphId":"g"}',
    ]);
    const s = reduceRunEventsToNodeOverlay(ev);
    expect(s.dead?.phase).toBe("skipped");
    expect(s.live?.phase).toBe("success");
  });

  it("node_pinned_skip marks success", () => {
    const ev = linesToEvents([
      '{"type":"node_pinned_skip","nodeId":"t1","graphId":"g"}',
    ]);
    expect(reduceRunEventsToNodeOverlay(ev).t1?.phase).toBe("success");
  });

  it("nested_graph_enter keeps parent running; nested_graph_exit is a no-op (see nodeRunOverlay.ts)", () => {
    const ev = linesToEvents([
      '{"type":"nested_graph_enter","parentNodeId":"gr","targetGraphId":"sub","depth":1,"path":"/gr"}',
      '{"type":"nested_graph_exit","parentNodeId":"gr","targetGraphId":"sub","depth":1}',
    ]);
    const s = reduceRunEventsToNodeOverlay(ev);
    expect(s.gr?.phase).toBe("running");
    expect(s.gr?.lastType).toBe("nested_graph_enter");
  });

  it("llm_agent: delegate + step events keep node running; node_exit succeeds", () => {
    const ev = linesToEvents([
      '{"type":"node_enter","nodeId":"a1","nodeType":"llm_agent","graphId":"g"}',
      '{"type":"agent_delegate_start","nodeId":"a1","graphId":"g"}',
      '{"type":"agent_step","nodeId":"a1","graphId":"g","step":1}',
      '{"type":"agent_tool_call","nodeId":"a1","graphId":"g","toolName":"x"}',
      '{"type":"node_exit","nodeId":"a1","nodeType":"llm_agent","graphId":"g"}',
    ]);
    const s = reduceRunEventsToNodeOverlay(ev);
    expect(s.a1?.phase).toBe("success");
    expect(s.a1?.lastType).toBe("node_exit");
  });

  it("llm_agent: agent_failed marks failed; node_exit does not clear", () => {
    const ev = linesToEvents([
      '{"type":"node_enter","nodeId":"a1","nodeType":"llm_agent","graphId":"g"}',
      '{"type":"agent_delegate_start","nodeId":"a1","graphId":"g"}',
      '{"type":"agent_failed","nodeId":"a1","graphId":"g","message":"x"}',
      '{"type":"node_exit","nodeId":"a1","nodeType":"llm_agent","graphId":"g"}',
    ]);
    const s = reduceRunEventsToNodeOverlay(ev);
    expect(s.a1?.phase).toBe("failed");
    expect(s.a1?.lastType).toBe("agent_failed");
  });
});

describe("applyParsedRunEventToOverlayState", () => {
  it("returns same reference when type is unknown", () => {
    const prev = { a: { phase: "success" as const, lastType: "x" } };
    const next = applyParsedRunEventToOverlayState(prev, { type: "process_output" });
    expect(next).toBe(prev);
  });
});
