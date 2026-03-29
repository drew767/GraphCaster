// Copyright GraphCaster. All Rights Reserved.

import type { Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import {
  classifyVisibility,
  computeVisibilityByNodeId,
  expandViewport,
  rectIntersectsViewport,
  viewportInnerFromTransform,
} from "./viewportNodeTier";

describe("viewportInnerFromTransform", () => {
  it("maps origin zoom=1 size 800x600", () => {
    const vp = viewportInnerFromTransform([0, 0, 1], 800, 600);
    expect(vp).toEqual({ minX: 0, minY: 0, maxX: 800, maxY: 600 });
  });

  it("shifts with translate at zoom 1", () => {
    const vp = viewportInnerFromTransform([-100, -200, 1], 800, 600);
    expect(vp).toEqual({ minX: 100, minY: 200, maxX: 900, maxY: 800 });
  });

  it("scales with zoom 2", () => {
    const vp = viewportInnerFromTransform([0, 0, 2], 800, 600);
    expect(vp).toEqual({ minX: 0, minY: 0, maxX: 400, maxY: 300 });
  });

  it("returns null for zero size", () => {
    expect(viewportInnerFromTransform([0, 0, 1], 0, 600)).toBeNull();
  });
});

describe("expandViewport + classifyVisibility", () => {
  const inner = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  const padded = expandViewport(inner, 20);

  it("node fully inside inner → in", () => {
    expect(classifyVisibility(inner, padded, { x: 10, y: 10, w: 20, h: 20 })).toBe("in");
  });

  it("node in padding band only → pad", () => {
    expect(classifyVisibility(inner, padded, { x: -15, y: 10, w: 10, h: 10 })).toBe("pad");
  });

  it("node fully outside padded → off", () => {
    expect(classifyVisibility(inner, padded, { x: -200, y: 0, w: 50, h: 50 })).toBe("off");
  });
});

describe("rectIntersectsViewport", () => {
  const vp = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
  it("touching edge intersects", () => {
    expect(rectIntersectsViewport({ x: 100, y: 50, w: 10, h: 10 }, vp)).toBe(true);
  });
  it("fully left does not", () => {
    expect(rectIntersectsViewport({ x: -20, y: 50, w: 10, h: 10 }, vp)).toBe(false);
  });
});

describe("computeVisibilityByNodeId", () => {
  it("uses world position for child with parent offset", () => {
    const group = {
      id: "g",
      type: "gcGroup",
      position: { x: 2000, y: 2000 },
      data: { raw: { width: 360, height: 220 } },
    } as Node;
    const child = {
      id: "c",
      type: "gcNode",
      position: { x: 0, y: 0 },
      parentId: "g",
      data: {},
    } as Node;
    const m = computeVisibilityByNodeId([group, child], [0, 0, 1], 800, 600, 0);
    expect(m.get("c")).toBe("off");
    expect(m.get("g")).toBe("off");
  });

  it("child inside viewport when parent near origin", () => {
    const group = {
      id: "g",
      type: "gcGroup",
      position: { x: 100, y: 100 },
      data: { raw: { width: 360, height: 220 } },
    } as Node;
    const child = {
      id: "c",
      type: "gcNode",
      position: { x: 10, y: 10 },
      parentId: "g",
      data: {},
    } as Node;
    const m = computeVisibilityByNodeId([group, child], [0, 0, 1], 800, 600, 0);
    expect(m.get("c")).toBe("in");
    expect(m.get("g")).toBe("in");
  });
});
