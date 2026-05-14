// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";
import type { Edge, Node } from "@xyflow/react";

import { findEdgeAtFlowPosition } from "./findEdgeAt";
import { splitEdgeWithNode } from "./splitEdge";

function makeNode(id: string, x: number, y: number, w = 200, h = 80): Node {
  return {
    id,
    type: "gcNode",
    position: { x, y },
    width: w,
    height: h,
    data: { graphNodeType: "task", label: id, raw: {} },
  };
}

describe("splitEdgeWithNode", () => {
  it("removes the original edge and wires source→new→target", () => {
    const nodes: Node[] = [makeNode("a", 0, 0), makeNode("b", 400, 0)];
    const edges: Edge[] = [
      { id: "e-ab", source: "a", target: "b", sourceHandle: "out_default" },
    ];
    const res = splitEdgeWithNode(nodes, edges, {
      edgeId: "e-ab",
      nodeType: "task",
      position: { x: 250, y: 40 },
      newNodeId: "n-new",
      newEdgeInId: "e-in",
      newEdgeOutId: "e-out",
    });
    expect(res.ids).toEqual({ newNodeId: "n-new", edgeInId: "e-in", edgeOutId: "e-out" });
    expect(res.nodes.map((n) => n.id)).toEqual(["a", "b", "n-new"]);
    expect(res.edges.map((e) => e.id).sort()).toEqual(["e-in", "e-out"]);
    const eIn = res.edges.find((e) => e.id === "e-in")!;
    expect(eIn.source).toBe("a");
    expect(eIn.target).toBe("n-new");
    const eOut = res.edges.find((e) => e.id === "e-out")!;
    expect(eOut.source).toBe("n-new");
    expect(eOut.target).toBe("b");
  });

  it("returns null ids and an unchanged graph when edge id is unknown", () => {
    const nodes: Node[] = [makeNode("a", 0, 0)];
    const edges: Edge[] = [{ id: "e-only", source: "a", target: "a" }];
    const res = splitEdgeWithNode(nodes, edges, {
      edgeId: "missing",
      nodeType: "task",
      position: { x: 0, y: 0 },
      newNodeId: "n",
      newEdgeInId: "i",
      newEdgeOutId: "o",
    });
    expect(res.ids).toBeNull();
    expect(res.nodes).toEqual(nodes);
    expect(res.edges).toEqual(edges);
  });
});

describe("drop on edge splits via findEdgeAtFlowPosition + splitEdgeWithNode", () => {
  it("splits the closest edge under the drop point", () => {
    // A=(100,40), B=(500,40). Drop at midpoint (~300, 42).
    const nodes: Node[] = [makeNode("a", 0, 0), makeNode("b", 400, 0)];
    const edges: Edge[] = [{ id: "e-ab", source: "a", target: "b" }];
    const dropX = 300;
    const dropY = 42;
    const hit = findEdgeAtFlowPosition(edges, nodes, dropX, dropY, 12);
    expect(hit?.id).toBe("e-ab");
    const res = splitEdgeWithNode(nodes, edges, {
      edgeId: hit!.id,
      nodeType: "task",
      position: { x: dropX, y: dropY },
      newNodeId: "n-mid",
      newEdgeInId: "e-l",
      newEdgeOutId: "e-r",
    });
    expect(res.nodes.find((n) => n.id === "n-mid")?.position).toEqual({
      x: dropX,
      y: dropY,
    });
    expect(res.edges.find((e) => e.id === "e-ab")).toBeUndefined();
    expect(res.edges.find((e) => e.source === "a" && e.target === "n-mid")).toBeTruthy();
    expect(res.edges.find((e) => e.source === "n-mid" && e.target === "b")).toBeTruthy();
  });
});
