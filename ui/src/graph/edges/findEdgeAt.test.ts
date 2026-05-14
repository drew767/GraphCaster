// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";
import type { Edge, Node } from "@xyflow/react";

import { findEdgeAtFlowPosition, pointToSegmentDistanceSq } from "./findEdgeAt";

function makeNode(id: string, x: number, y: number, w = 200, h = 80): Node {
  return {
    id,
    type: "gcNode",
    position: { x, y },
    width: w,
    height: h,
    data: {},
  };
}

function makeEdge(id: string, source: string, target: string): Edge {
  return { id, source, target };
}

describe("pointToSegmentDistanceSq", () => {
  it("returns 0 for a point on the segment", () => {
    expect(pointToSegmentDistanceSq(5, 0, 0, 0, 10, 0)).toBe(0);
  });
  it("clamps to endpoint A when projection is behind", () => {
    expect(pointToSegmentDistanceSq(-3, 0, 0, 0, 10, 0)).toBeCloseTo(9);
  });
  it("clamps to endpoint B when projection is past the end", () => {
    expect(pointToSegmentDistanceSq(20, 0, 0, 0, 10, 0)).toBeCloseTo(100);
  });
});

describe("findEdgeAtFlowPosition", () => {
  const nodes: Node[] = [
    // centers: A=(100,40), B=(500,40)
    makeNode("A", 0, 0),
    makeNode("B", 400, 0),
    // C center=(100,540), far away on Y
    makeNode("C", 0, 500),
  ];
  const edges: Edge[] = [makeEdge("e-ab", "A", "B"), makeEdge("e-ac", "A", "C")];

  it("returns the edge whose segment is within tolerance of the drop point", () => {
    // Drop directly on horizontal segment A→B near its midpoint.
    const hit = findEdgeAtFlowPosition(edges, nodes, 300, 42);
    expect(hit?.id).toBe("e-ab");
  });

  it("returns null when no edge is within tolerance", () => {
    const hit = findEdgeAtFlowPosition(edges, nodes, 800, 800, 12);
    expect(hit).toBeNull();
  });

  it("returns the closest edge when several are near", () => {
    // Both horizontal AB and vertical AC pass near (100, 40). AC center is at
    // x=100, AB starts at (100,40), so (101, 41) is essentially on both — but
    // segment AB is exactly at y=40, segment AC is exactly at x=100. The
    // closer one to (101,41) is AB (distance 1) vs AC (distance 1). Pick by
    // tie-breaking on iteration order = first edge = AB.
    const hit = findEdgeAtFlowPosition(edges, nodes, 101, 41, 12);
    expect(hit?.id).toBe("e-ab");
  });

  it("returns null when edges or nodes are empty", () => {
    expect(findEdgeAtFlowPosition([], nodes, 0, 0)).toBeNull();
    expect(findEdgeAtFlowPosition(edges, [], 0, 0)).toBeNull();
  });

  it("ignores edges referencing missing nodes", () => {
    const stray: Edge[] = [makeEdge("e-x", "missing", "B")];
    expect(findEdgeAtFlowPosition(stray, nodes, 100, 40)).toBeNull();
  });
});
