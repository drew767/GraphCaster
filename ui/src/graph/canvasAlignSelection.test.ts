// Copyright GraphCaster. All Rights Reserved.

import type { Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import {
  alignSelectionPossible,
  applyAlignDistribute,
  distributeSelectionPossible,
  partitionSelectedByParent,
} from "./canvasAlignSelection";
import type { GcNodeData } from "./toReactFlow";

function flowNode(
  id: string,
  x: number,
  y: number,
  parentId?: string,
): Node<GcNodeData> {
  return {
    id,
    type: "gcNode",
    position: { x, y },
    width: 10,
    height: 10,
    data: { graphNodeType: "task", label: id, raw: {} },
    ...(parentId ? { parentId } : {}),
  } as Node<GcNodeData>;
}

describe("canvasAlignSelection", () => {
  it("partitions by parentId", () => {
    const nodes = [flowNode("a", 0, 0), flowNode("b", 10, 0, "p1"), flowNode("c", 20, 0, "p1")];
    const m = partitionSelectedByParent(nodes, new Set(["a", "b", "c"]));
    expect(m.get("")?.map((n) => n.id)).toEqual(["a"]);
    expect(m.get("p1")?.map((n) => n.id)).toEqual(["b", "c"]);
  });

  it("align-left moves nodes to min x within parent bucket", () => {
    const nodes = [flowNode("a", 40, 5), flowNode("b", 10, 20)];
    const next = applyAlignDistribute(nodes, new Set(["a", "b"]), "align-left");
    expect(next).not.toBeNull();
    const byId = new Map(next!.map((n) => [n.id, n]));
    expect(byId.get("a")!.position.x).toBe(10);
    expect(byId.get("b")!.position.x).toBe(10);
    expect(byId.get("a")!.position.y).toBe(5);
    expect(byId.get("b")!.position.y).toBe(20);
  });

  it("alignSelectionPossible requires 2 in same parent bucket", () => {
    const nodes = [flowNode("a", 0, 0), flowNode("b", 10, 0, "p")];
    expect(alignSelectionPossible(nodes, new Set(["a", "b"]))).toBe(false);
    expect(alignSelectionPossible(nodes, new Set(["b"]))).toBe(false);
  });

  it("two nodes same parent can align", () => {
    const nodes = [flowNode("a", 40, 0, "p"), flowNode("b", 10, 0, "p")];
    expect(alignSelectionPossible(nodes, new Set(["a", "b"]))).toBe(true);
  });

  it("distribute-h with three nodes equal gaps", () => {
    const nodes = [
      flowNode("a", 0, 0, "p"),
      flowNode("b", 50, 0, "p"),
      flowNode("c", 200, 0, "p"),
    ];
    const next = applyAlignDistribute(nodes, new Set(["a", "b", "c"]), "distribute-h");
    expect(next).not.toBeNull();
    const byId = new Map(next!.map((n) => [n.id, n]));
    expect(byId.get("a")!.position.x).toBe(0);
    expect(byId.get("c")!.position.x).toBe(200);
    const xb = byId.get("b")!.position.x;
    expect(xb).toBeGreaterThan(0);
    expect(xb).toBeLessThan(200);
  });

  it("distributeSelectionPossible requires 3 in a bucket", () => {
    const nodes = [flowNode("a", 0, 0), flowNode("b", 10, 0), flowNode("c", 20, 0)];
    expect(distributeSelectionPossible(nodes, new Set(["a", "b"]))).toBe(false);
    expect(distributeSelectionPossible(nodes, new Set(["a", "b", "c"]))).toBe(true);
  });

  it("independent buckets align in one call", () => {
    const nodes = [
      flowNode("r1", 50, 0),
      flowNode("r2", 10, 0),
      flowNode("c1", 30, 0, "parent"),
      flowNode("c2", 5, 0, "parent"),
    ];
    const next = applyAlignDistribute(
      nodes,
      new Set(["r1", "r2", "c1", "c2"]),
      "align-left",
    );
    expect(next).not.toBeNull();
    const m = new Map(next!.map((n) => [n.id, n]));
    expect(m.get("r1")!.position.x).toBe(10);
    expect(m.get("r2")!.position.x).toBe(10);
    expect(m.get("c1")!.position.x).toBe(5);
    expect(m.get("c2")!.position.x).toBe(5);
  });
});
