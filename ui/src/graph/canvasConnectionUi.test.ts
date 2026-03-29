// Copyright GraphCaster. All Rights Reserved.

import { ConnectionLineType } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import {
  connectionLineStyleForTheme,
  GC_CONNECTION_RADIUS,
  gcConnectionLineType,
} from "./canvasConnectionUi";

describe("canvasConnectionUi", () => {
  it("uses Bezier for preview to match GcBranchEdge geometry", () => {
    expect(gcConnectionLineType).toBe(ConnectionLineType.Bezier);
  });

  it("uses radius 28 (above React Flow default 20) for easier handle snapping", () => {
    expect(GC_CONNECTION_RADIUS).toBe(28);
  });

  it("light theme stroke matches accent", () => {
    const s = connectionLineStyleForTheme(false);
    expect(s.stroke).toBe("#007aff");
    expect(Number(s.strokeWidth)).toBeGreaterThanOrEqual(2);
  });

  it("dark theme stroke is readable on dark pane", () => {
    const s = connectionLineStyleForTheme(true);
    expect(s.stroke).toBe("#409cff");
  });
});
