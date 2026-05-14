// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import {
  CANVAS_AUTO_PAN_EDGE_PX,
  CANVAS_AUTO_PAN_STEP_PX,
  computeAutoPanDirection,
} from "./useCanvasAutoPan";

const RECT = { left: 0, top: 0, right: 1000, bottom: 800 };

describe("computeAutoPanDirection", () => {
  it("returns zero when pointer is well inside the viewport", () => {
    const d = computeAutoPanDirection(500, 400, RECT);
    expect(d).toEqual({ dx: 0, dy: 0 });
  });

  it("pans right (dx > 0) when near the left edge", () => {
    const d = computeAutoPanDirection(10, 400, RECT);
    expect(d.dx).toBe(CANVAS_AUTO_PAN_STEP_PX);
    expect(d.dy).toBe(0);
  });

  it("pans left (dx < 0) when near the right edge", () => {
    const d = computeAutoPanDirection(995, 400, RECT);
    expect(d.dx).toBe(-CANVAS_AUTO_PAN_STEP_PX);
    expect(d.dy).toBe(0);
  });

  it("pans down (dy > 0) when near the top edge", () => {
    const d = computeAutoPanDirection(500, 10, RECT);
    expect(d.dy).toBe(CANVAS_AUTO_PAN_STEP_PX);
    expect(d.dx).toBe(0);
  });

  it("pans up (dy < 0) when near the bottom edge", () => {
    const d = computeAutoPanDirection(500, 795, RECT);
    expect(d.dy).toBe(-CANVAS_AUTO_PAN_STEP_PX);
    expect(d.dx).toBe(0);
  });

  it("pans diagonally when near a corner", () => {
    const d = computeAutoPanDirection(5, 5, RECT);
    expect(d.dx).toBe(CANVAS_AUTO_PAN_STEP_PX);
    expect(d.dy).toBe(CANVAS_AUTO_PAN_STEP_PX);
  });

  it("uses the 40px edge zone by default", () => {
    const inside = computeAutoPanDirection(CANVAS_AUTO_PAN_EDGE_PX + 1, 400, RECT);
    expect(inside).toEqual({ dx: 0, dy: 0 });
    const onBoundary = computeAutoPanDirection(CANVAS_AUTO_PAN_EDGE_PX - 1, 400, RECT);
    expect(onBoundary.dx).toBe(CANVAS_AUTO_PAN_STEP_PX);
  });
});
