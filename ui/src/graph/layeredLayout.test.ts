// Copyright GraphCaster. All Rights Reserved.

import type { Edge, NodeData } from "@xyflow/react";
import type { Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import { layeredLayoutPositions } from "./layeredLayout";

describe("layeredLayoutPositions", () => {
  it("assigns non-zero coordinates for chained nodes", () => {
    const nodes: Node<NodeData>[] = [
      { id: "a", position: { x: 0, y: 0 }, data: {} },
      { id: "b", position: { x: 0, y: 0 }, data: {} },
    ];
    const edges: Edge[] = [{ id: "e", source: "a", target: "b" }];
    const pos = layeredLayoutPositions(nodes, edges, { direction: "LR" });
    expect(pos.get("a")).toBeDefined();
    expect(pos.get("b")).toBeDefined();
    expect(pos.get("a")!.x).not.toBe(pos.get("b")!.x);
  });
});
