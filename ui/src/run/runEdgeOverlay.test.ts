// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import {
  applyParsedRunEventToEdgeRunOverlay,
  edgeRunOverlayStatesEqual,
  initialEdgeRunOverlay,
} from "./runEdgeOverlay";

describe("runEdgeOverlay", () => {
  it("sets highlighted edge on branch_taken", () => {
    let s = initialEdgeRunOverlay();
    s = applyParsedRunEventToEdgeRunOverlay(s, {
      type: "branch_taken",
      edgeId: "e1",
      fromNode: "a",
      toNode: "b",
      graphId: "g",
    });
    expect(s.highlightedEdgeId).toBe("e1");
  });

  it("sets highlighted edge on edge_traverse", () => {
    let s = initialEdgeRunOverlay();
    s = applyParsedRunEventToEdgeRunOverlay(s, {
      type: "edge_traverse",
      edgeId: "e2",
      fromNode: "a",
      toNode: "b",
    });
    expect(s.highlightedEdgeId).toBe("e2");
  });

  it("clears on run_finished", () => {
    let s = initialEdgeRunOverlay();
    s = applyParsedRunEventToEdgeRunOverlay(s, {
      type: "branch_taken",
      edgeId: "e1",
      fromNode: "a",
      toNode: "b",
      graphId: "g",
    });
    s = applyParsedRunEventToEdgeRunOverlay(s, {
      type: "run_finished",
      runId: "r1",
      status: "success",
    });
    expect(s.highlightedEdgeId).toBeNull();
  });

  it("clears on run_success", () => {
    let s = initialEdgeRunOverlay();
    s = applyParsedRunEventToEdgeRunOverlay(s, {
      type: "edge_traverse",
      edgeId: "e1",
      fromNode: "a",
      toNode: "b",
    });
    s = applyParsedRunEventToEdgeRunOverlay(s, {
      type: "run_success",
      nodeId: "exit1",
      graphId: "g",
    });
    expect(s.highlightedEdgeId).toBeNull();
  });

  it("clears on run_started", () => {
    let s = initialEdgeRunOverlay();
    s = applyParsedRunEventToEdgeRunOverlay(s, {
      type: "branch_taken",
      edgeId: "e1",
      fromNode: "a",
      toNode: "b",
      graphId: "g",
    });
    s = applyParsedRunEventToEdgeRunOverlay(s, { type: "run_started", runId: "r2", graphId: "g" });
    expect(s.highlightedEdgeId).toBeNull();
  });

  it("returns same reference when unchanged", () => {
    const s0 = initialEdgeRunOverlay();
    const s1 = applyParsedRunEventToEdgeRunOverlay(s0, { type: "node_enter", nodeId: "n1" });
    expect(s1).toBe(s0);
  });

  it("edgeRunOverlayStatesEqual", () => {
    expect(
      edgeRunOverlayStatesEqual(initialEdgeRunOverlay(), { highlightedEdgeId: null }),
    ).toBe(true);
    expect(
      edgeRunOverlayStatesEqual({ highlightedEdgeId: "a" }, { highlightedEdgeId: "a" }),
    ).toBe(true);
    expect(
      edgeRunOverlayStatesEqual({ highlightedEdgeId: "a" }, { highlightedEdgeId: "b" }),
    ).toBe(false);
  });
});
