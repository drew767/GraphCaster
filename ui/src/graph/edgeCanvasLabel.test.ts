// Copyright GraphCaster. All Rights Reserved.

import type { Edge } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import {
  EDGE_CANVAS_LABEL_MAX_LEN,
  edgeCanvasLabelText,
  flowEdgeLabelToCondition,
  truncateEdgeCanvasLabel,
} from "./edgeCanvasLabel";

describe("flowEdgeLabelToCondition", () => {
  it("returns null for null/undefined", () => {
    expect(flowEdgeLabelToCondition(null)).toBeNull();
    expect(flowEdgeLabelToCondition(undefined)).toBeNull();
  });

  it("trims non-empty string", () => {
    expect(flowEdgeLabelToCondition("  x  ")).toBe("x");
  });

  it("returns null for blank string", () => {
    expect(flowEdgeLabelToCondition("   ")).toBeNull();
    expect(flowEdgeLabelToCondition("")).toBeNull();
  });

  it("ignores non-string labels (React Flow allows wider types)", () => {
    expect(flowEdgeLabelToCondition(42 as Edge["label"])).toBeNull();
    expect(flowEdgeLabelToCondition({} as Edge["label"])).toBeNull();
  });
});

describe("truncateEdgeCanvasLabel", () => {
  it("returns trimmed text when within max", () => {
    expect(truncateEdgeCanvasLabel("  hi  ", 10)).toBe("hi");
  });

  it("truncates with ellipsis when longer than max", () => {
    const long = "a".repeat(EDGE_CANVAS_LABEL_MAX_LEN + 5);
    const out = truncateEdgeCanvasLabel(long);
    expect(out.length).toBe(EDGE_CANVAS_LABEL_MAX_LEN);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("edgeCanvasLabelText", () => {
  const fb = "Branch";

  it("non–ai_route: shows condition only", () => {
    expect(
      edgeCanvasLabelText({
        condition: "x > 0",
        routeDescription: "ignored",
        sourceIsAiRoute: false,
        branchFallbackLabel: fb,
      }),
    ).toBe("x > 0");
  });

  it("non–ai_route: empty when no condition", () => {
    expect(
      edgeCanvasLabelText({
        condition: null,
        routeDescription: "only route",
        sourceIsAiRoute: false,
        branchFallbackLabel: fb,
      }),
    ).toBe("");
  });

  it("ai_route: prefers routeDescription over condition", () => {
    expect(
      edgeCanvasLabelText({
        condition: "cond",
        routeDescription: "Left",
        sourceIsAiRoute: true,
        branchFallbackLabel: fb,
      }),
    ).toBe("Left");
  });

  it("ai_route: falls back to condition when route empty", () => {
    expect(
      edgeCanvasLabelText({
        condition: "  c  ",
        routeDescription: "   ",
        sourceIsAiRoute: true,
        branchFallbackLabel: fb,
      }),
    ).toBe("c");
  });

  it("ai_route: uses fallback when route and condition empty", () => {
    expect(
      edgeCanvasLabelText({
        condition: null,
        routeDescription: "",
        sourceIsAiRoute: true,
        branchFallbackLabel: fb,
      }),
    ).toBe(fb);
  });
});
