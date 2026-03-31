// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import { visibleNodeIdsForViewport } from "./virtualization";

describe("visibleNodeIdsForViewport", () => {
  it("includes nodes inside the viewport and excludes distant ones", () => {
    const nodes = [
      { id: "a", position: { x: 0, y: 0 }, width: 100, height: 40 },
      { id: "b", position: { x: 5000, y: 5000 }, width: 100, height: 40 },
    ];
    const v = visibleNodeIdsForViewport(
      nodes,
      { x: 50, y: 20, zoom: 1 },
      800,
      600,
      0,
    );
    expect(v.has("a")).toBe(true);
    expect(v.has("b")).toBe(false);
  });
});
