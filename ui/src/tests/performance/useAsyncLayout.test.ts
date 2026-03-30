// Copyright GraphCaster. All Rights Reserved.

import { renderHook } from "@testing-library/react";
import type { Edge, NodeData } from "@xyflow/react";
import type { Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import { useAsyncLayout } from "../../components/canvas/hooks/useAsyncLayout";

describe("useAsyncLayout", () => {
  const mockNodes: Node<NodeData>[] = [
    { id: "1", position: { x: 0, y: 0 }, data: { label: "Start" } },
    { id: "2", position: { x: 0, y: 0 }, data: { label: "Task" } },
    { id: "3", position: { x: 0, y: 0 }, data: { label: "End" } },
  ];

  const mockEdges: Edge[] = [
    { id: "e1-2", source: "1", target: "2" },
    { id: "e2-3", source: "2", target: "3" },
  ];

  it("computes layout synchronously (not loading)", () => {
    const { result } = renderHook(() => useAsyncLayout(mockNodes, mockEdges));

    expect(result.current.isLayouting).toBe(false);
    const layoutedNodes = result.current.layoutedNodes;
    expect(layoutedNodes.some((n) => n.position.x !== 0 || n.position.y !== 0)).toBe(true);
  });

  it("returns same reference when inputs unchanged", () => {
    const { result, rerender } = renderHook(({ nodes, edges }) => useAsyncLayout(nodes, edges), {
      initialProps: { nodes: mockNodes, edges: mockEdges },
    });

    const first = result.current.layoutedNodes;
    rerender({ nodes: mockNodes, edges: mockEdges });

    expect(result.current.layoutedNodes).toBe(first);
  });

  it("cancels pending layout on unmount", () => {
    const { unmount } = renderHook(() => useAsyncLayout(mockNodes, mockEdges));

    unmount();
  });
});
