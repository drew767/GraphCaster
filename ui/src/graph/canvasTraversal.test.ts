// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";
import type { Edge, Node } from "@xyflow/react";

import { findAdjacentSibling, findDownstreamNodes, findUpstreamNodes } from "./canvasTraversal";

function node(id: string, x: number, y: number): Node {
  return {
    id,
    position: { x, y },
    data: {},
    type: "gcNode",
  } as Node;
}

function edge(id: string, source: string, target: string): Edge {
  return { id, source, target } as Edge;
}

/* ─────────────────────────────────────────────────────────
   UX84 — upstream traversal
   ───────────────────────────────────────────────────────── */
describe("findUpstreamNodes", () => {
  it("returns direct upstream parent", () => {
    const nodes = [node("a", 0, 0), node("b", 100, 0), node("c", 200, 0)];
    const edges = [edge("e1", "a", "b"), edge("e2", "b", "c")];
    const result = findUpstreamNodes("c", nodes, edges);
    expect(result.map((n) => n.id).sort()).toEqual(["a", "b"]);
  });

  it("returns empty array when no upstream nodes exist", () => {
    const nodes = [node("a", 0, 0), node("b", 100, 0)];
    const edges = [edge("e1", "a", "b")];
    const result = findUpstreamNodes("a", nodes, edges);
    expect(result).toHaveLength(0);
  });

  it("handles branching: multiple paths upstream", () => {
    const nodes = [node("a", 0, 0), node("b", 0, 100), node("c", 100, 50)];
    const edges = [edge("e1", "a", "c"), edge("e2", "b", "c")];
    const result = findUpstreamNodes("c", nodes, edges);
    expect(result.map((n) => n.id).sort()).toEqual(["a", "b"]);
  });
});

/* ─────────────────────────────────────────────────────────
   UX84 — downstream traversal
   ───────────────────────────────────────────────────────── */
describe("findDownstreamNodes", () => {
  it("returns direct downstream child", () => {
    const nodes = [node("a", 0, 0), node("b", 100, 0), node("c", 200, 0)];
    const edges = [edge("e1", "a", "b"), edge("e2", "b", "c")];
    const result = findDownstreamNodes("a", nodes, edges);
    expect(result.map((n) => n.id).sort()).toEqual(["b", "c"]);
  });

  it("returns empty array when no downstream nodes exist", () => {
    const nodes = [node("a", 0, 0), node("b", 100, 0)];
    const edges = [edge("e1", "a", "b")];
    const result = findDownstreamNodes("b", nodes, edges);
    expect(result).toHaveLength(0);
  });

  it("handles branching: multiple paths downstream", () => {
    const nodes = [node("a", 0, 0), node("b", 100, -50), node("c", 100, 50)];
    const edges = [edge("e1", "a", "b"), edge("e2", "a", "c")];
    const result = findDownstreamNodes("a", nodes, edges);
    expect(result.map((n) => n.id).sort()).toEqual(["b", "c"]);
  });
});

/* ─────────────────────────────────────────────────────────
   UX84 — adjacent sibling navigation
   ───────────────────────────────────────────────────────── */
describe("findAdjacentSibling", () => {
  it("finds node above (up direction)", () => {
    const nodes = [node("a", 0, 0), node("b", 0, -100)];
    const result = findAdjacentSibling("a", "up", nodes);
    expect(result?.id).toBe("b");
  });

  it("finds node below (down direction)", () => {
    const nodes = [node("a", 0, 0), node("b", 0, 100)];
    const result = findAdjacentSibling("a", "down", nodes);
    expect(result?.id).toBe("b");
  });

  it("finds node to the left (left direction)", () => {
    const nodes = [node("a", 200, 0), node("b", 0, 0)];
    const result = findAdjacentSibling("a", "left", nodes);
    expect(result?.id).toBe("b");
  });

  it("finds node to the right (right direction)", () => {
    const nodes = [node("a", 0, 0), node("b", 200, 0)];
    const result = findAdjacentSibling("a", "right", nodes);
    expect(result?.id).toBe("b");
  });

  it("returns null when no node exists in that direction", () => {
    const nodes = [node("a", 0, 0), node("b", 100, 0)];
    const result = findAdjacentSibling("a", "up", nodes);
    expect(result).toBeNull();
  });

  it("returns null for unknown nodeId", () => {
    const nodes = [node("a", 0, 0)];
    const result = findAdjacentSibling("unknown", "up", nodes);
    expect(result).toBeNull();
  });

  it("picks closest node when multiple are in the same direction", () => {
    const nodes = [node("a", 0, 0), node("close", 50, 0), node("far", 400, 0)];
    const result = findAdjacentSibling("a", "right", nodes);
    expect(result?.id).toBe("close");
  });
});
