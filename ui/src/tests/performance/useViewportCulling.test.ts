// Copyright GraphCaster. All Rights Reserved.

import { renderHook } from "@testing-library/react";
import type { Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import {
  useViewportCulling,
  type CullingViewport,
} from "../../components/canvas/hooks/useViewportCulling";

describe("useViewportCulling", () => {
  const mockNodes: Node[] = Array.from({ length: 100 }, (_, i) => ({
    id: `node-${i}`,
    position: { x: (i % 10) * 200, y: Math.floor(i / 10) * 200 },
    data: { label: `Node ${i}` },
    type: "default",
  }));

  const viewport: CullingViewport = {
    x: 0,
    y: 0,
    width: 800,
    height: 600,
    zoom: 1,
  };

  it("returns only nodes within viewport", () => {
    const { result } = renderHook(() => useViewportCulling(mockNodes, viewport, { padding: 0 }));

    // 10×10 grid at 200px; 800×600 viewport can include a full row/column band (~≤20 nodes with default 200×100 bounds).
    expect(result.current.visibleNodes.length).toBeLessThanOrEqual(22);
    expect(result.current.visibleNodes.length).toBeGreaterThan(8);
  });

  it("includes padding around viewport", () => {
    const { result: withPadding } = renderHook(() =>
      useViewportCulling(mockNodes, viewport, { padding: 200 }),
    );
    const { result: withoutPadding } = renderHook(() =>
      useViewportCulling(mockNodes, viewport, { padding: 0 }),
    );

    expect(withPadding.current.visibleNodes.length).toBeGreaterThan(withoutPadding.current.visibleNodes.length);
  });

  it("adjusts for zoom level", () => {
    const zoomedOut = { ...viewport, zoom: 0.5 };
    const { result } = renderHook(() => useViewportCulling(mockNodes, zoomedOut, { padding: 0 }));

    expect(result.current.visibleNodes.length).toBeGreaterThan(20);
  });

  it("returns visible node IDs as Set for fast lookup", () => {
    const { result } = renderHook(() => useViewportCulling(mockNodes, viewport));

    expect(result.current.visibleNodeIds).toBeInstanceOf(Set);
    expect(result.current.visibleNodeIds.has("node-0")).toBe(true);
  });

  it("memoizes result when inputs unchanged", () => {
    const { result, rerender } = renderHook(({ nodes, vp }) => useViewportCulling(nodes, vp), {
      initialProps: { nodes: mockNodes, vp: viewport },
    });

    const first = result.current;
    rerender({ nodes: mockNodes, vp: viewport });

    expect(result.current).toBe(first);
  });
});
