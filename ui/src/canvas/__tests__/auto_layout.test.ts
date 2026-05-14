// Copyright GraphCaster. All Rights Reserved.

// NOTE: dagre/elkjs/html-to-image are not in package.json yet — vitest.config.ts
// points them to local stubs so these tests can run. Replace stubs with real packages
// and remove the aliases when the dependencies are properly declared.

import type { Edge, Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import { autoLayout } from "../auto_layout";

function makeNode(id: string, x = 0, y = 0, parentId?: string): Node {
  return {
    id,
    position: { x, y },
    data: {},
    width: 200,
    height: 80,
    ...(parentId ? { parentId } : {}),
  } as Node;
}

function makeEdge(id: string, source: string, target: string): Edge {
  return { id, source, target } as Edge;
}

describe("autoLayout — dagre-lr", () => {
  it("source.x < target.x for each edge in LR layout", async () => {
    const nodes = [makeNode("a"), makeNode("b"), makeNode("c")];
    const edges = [makeEdge("e1", "a", "b"), makeEdge("e2", "b", "c")];
    const { nodes: laid } = await autoLayout(nodes, edges, { algorithm: "dagre-lr" });
    const byId = new Map(laid.map((n) => [n.id, n]));
    for (const e of edges) {
      const src = byId.get(e.source)!;
      const tgt = byId.get(e.target)!;
      expect(src.position.x).toBeLessThan(tgt.position.x);
    }
  });

  it("preserves original node ids", async () => {
    const nodes = [makeNode("n1"), makeNode("n2")];
    const edges = [makeEdge("e1", "n1", "n2")];
    const { nodes: laid } = await autoLayout(nodes, edges, { algorithm: "dagre-lr" });
    expect(laid.map((n) => n.id).sort()).toEqual(["n1", "n2"]);
  });
});

describe("autoLayout — dagre-tb", () => {
  it("source.y < target.y for each edge in TB layout", async () => {
    const nodes = [makeNode("a"), makeNode("b"), makeNode("c")];
    const edges = [makeEdge("e1", "a", "b"), makeEdge("e2", "b", "c")];
    const { nodes: laid } = await autoLayout(nodes, edges, { algorithm: "dagre-tb" });
    const byId = new Map(laid.map((n) => [n.id, n]));
    for (const e of edges) {
      const src = byId.get(e.source)!;
      const tgt = byId.get(e.target)!;
      expect(src.position.y).toBeLessThan(tgt.position.y);
    }
  });
});

describe("autoLayout — elk-layered", () => {
  it("completes without error and all nodes have unique positions", async () => {
    const nodes = [makeNode("a"), makeNode("b"), makeNode("c")];
    const edges = [makeEdge("e1", "a", "b"), makeEdge("e2", "b", "c")];
    const { nodes: laid } = await autoLayout(nodes, edges, { algorithm: "elk-layered" });
    expect(laid).toHaveLength(3);
    const posKeys = laid.map((n) => `${n.position.x},${n.position.y}`);
    const unique = new Set(posKeys);
    expect(unique.size).toBe(3);
  });
});

describe("autoLayout — elk-force", () => {
  it("completes without error", async () => {
    const nodes = [makeNode("a"), makeNode("b")];
    const edges = [makeEdge("e1", "a", "b")];
    const { nodes: laid } = await autoLayout(nodes, edges, { algorithm: "elk-force" });
    expect(laid).toHaveLength(2);
  });
});

describe("autoLayout — respectGroups", () => {
  it("returns positions for all nodes including those with parentId when respectGroups=true", async () => {
    const nodes = [
      makeNode("a"),
      makeNode("b"),
      makeNode("c1", 0, 0, "b"),
      makeNode("c2", 0, 0, "b"),
    ];
    const edges = [makeEdge("e1", "a", "b")];
    const { nodes: laid } = await autoLayout(nodes, edges, {
      algorithm: "dagre-lr",
      respectGroups: true,
    });
    expect(laid).toHaveLength(4);
    for (const n of laid) {
      expect(Number.isFinite(n.position.x)).toBe(true);
      expect(Number.isFinite(n.position.y)).toBe(true);
    }
  });

  it("respectGroups=false still returns all nodes", async () => {
    const nodes = [
      makeNode("a"),
      makeNode("b", 0, 0, "a"),
    ];
    const edges: Edge[] = [];
    const { nodes: laid } = await autoLayout(nodes, edges, {
      algorithm: "dagre-lr",
      respectGroups: false,
    });
    expect(laid).toHaveLength(2);
  });
});

describe("autoLayout — empty graph", () => {
  it("returns empty arrays for empty input", async () => {
    const { nodes, edges } = await autoLayout([], [], { algorithm: "dagre-lr" });
    expect(nodes).toEqual([]);
    expect(edges).toEqual([]);
  });
});
