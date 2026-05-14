// Copyright GraphCaster. All Rights Reserved.

import type { Edge, Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import { tidyUp } from "./dagre";

function makeNode(id: string, x = 0, y = 0): Node {
  return {
    id,
    type: "gcNode",
    position: { x, y },
    data: {},
    width: 200,
    height: 80,
  };
}

function makeEdge(id: string, source: string, target: string): Edge {
  return { id, source, target };
}

describe("tidyUp", () => {
  it("returns empty array for empty input", async () => {
    const out = await tidyUp([], []);
    expect(out).toEqual([]);
  });

  it("returns same number of nodes", async () => {
    const nodes: Node[] = [makeNode("a"), makeNode("b"), makeNode("c")];
    const edges: Edge[] = [makeEdge("e1", "a", "b"), makeEdge("e2", "b", "c")];
    const out = await tidyUp(nodes, edges, "LR");
    expect(out).toHaveLength(3);
    expect(out.map((n) => n.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("LR direction places connected nodes with increasing x", async () => {
    const nodes: Node[] = [makeNode("a"), makeNode("b"), makeNode("c")];
    const edges: Edge[] = [makeEdge("e1", "a", "b"), makeEdge("e2", "b", "c")];
    const out = await tidyUp(nodes, edges, "LR");
    const byId = new Map(out.map((n) => [n.id, n]));
    const ax = byId.get("a")!.position.x;
    const bx = byId.get("b")!.position.x;
    const cx = byId.get("c")!.position.x;
    expect(ax).toBeLessThan(bx);
    expect(bx).toBeLessThan(cx);
  });

  it("TB direction places connected nodes with increasing y", async () => {
    const nodes: Node[] = [makeNode("a"), makeNode("b"), makeNode("c")];
    const edges: Edge[] = [makeEdge("e1", "a", "b"), makeEdge("e2", "b", "c")];
    const out = await tidyUp(nodes, edges, "TB");
    const byId = new Map(out.map((n) => [n.id, n]));
    const ay = byId.get("a")!.position.y;
    const by = byId.get("b")!.position.y;
    const cy = byId.get("c")!.position.y;
    expect(ay).toBeLessThan(by);
    expect(by).toBeLessThan(cy);
  });

  it("preserves node identity (other fields untouched)", async () => {
    const a: Node = { ...makeNode("a"), data: { foo: "bar" } };
    const b: Node = { ...makeNode("b"), data: { foo: "baz" } };
    const out = await tidyUp([a, b], [makeEdge("e1", "a", "b")], "LR");
    const outA = out.find((n) => n.id === "a")!;
    const outB = out.find((n) => n.id === "b")!;
    expect(outA.data).toEqual({ foo: "bar" });
    expect(outB.data).toEqual({ foo: "baz" });
    expect(outA.type).toBe("gcNode");
  });
});
