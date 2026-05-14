// Copyright GraphCaster. All Rights Reserved.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyParsedRunEventToFiredEdges,
  EDGE_FIRED_WINDOW_MS,
  getCurrentRunningEdges,
  registerOutgoingEdgesProvider,
  runEdgeFiredOverlayResetForTest,
  runEdgeMarkFired,
  runEdgeMarkFiredFromNode,
} from "./runEdgeFiredOverlay";

beforeEach(() => {
  vi.useFakeTimers();
  runEdgeFiredOverlayResetForTest();
});

afterEach(() => {
  vi.useRealTimers();
  runEdgeFiredOverlayResetForTest();
  registerOutgoingEdgesProvider(null);
});

describe("runEdgeFiredOverlay", () => {
  it("marks an edge as fired then auto-clears after the window", () => {
    runEdgeMarkFired("e1");
    expect(getCurrentRunningEdges().has("e1")).toBe(true);
    vi.advanceTimersByTime(EDGE_FIRED_WINDOW_MS + 1);
    expect(getCurrentRunningEdges().has("e1")).toBe(false);
  });

  it("marks all outgoing edges from a source node", () => {
    runEdgeMarkFiredFromNode("a", [
      { id: "e1", source: "a" },
      { id: "e2", source: "a" },
      { id: "e3", source: "b" },
    ]);
    expect(getCurrentRunningEdges().has("e1")).toBe(true);
    expect(getCurrentRunningEdges().has("e2")).toBe(true);
    expect(getCurrentRunningEdges().has("e3")).toBe(false);
  });

  it("applyParsedRunEventToFiredEdges fires outgoing edges on node_exit via registered provider", () => {
    registerOutgoingEdgesProvider((src) => {
      if (src === "n1") {
        return [
          { id: "out1", source: "n1" },
          { id: "out2", source: "n1" },
        ];
      }
      return [];
    });
    applyParsedRunEventToFiredEdges({ type: "node_exit", nodeId: "n1" });
    expect(getCurrentRunningEdges().has("out1")).toBe(true);
    expect(getCurrentRunningEdges().has("out2")).toBe(true);
  });

  it("does nothing for unrelated event types", () => {
    registerOutgoingEdgesProvider((_src) => [{ id: "x", source: _src }]);
    applyParsedRunEventToFiredEdges({ type: "node_enter", nodeId: "n1" });
    expect(getCurrentRunningEdges().size).toBe(0);
  });
});
