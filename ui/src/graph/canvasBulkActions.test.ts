// Copyright GraphCaster. All Rights Reserved.

import type { Node } from "@xyflow/react";
import { describe, it, expect } from "vitest";

import type { GcNodeData } from "./toReactFlow";
import {
  BULK_DUPLICATE_OFFSET,
  BULK_STICKY_PADDING_PX,
  applyDuplicateSelection,
  applyGroupSelectionIntoSticky,
  applyToggleMuteOnSelection,
  bulkSelectionBBox,
  isNodeMuted,
  selectionAllMuted,
} from "./canvasBulkActions";

function makeNode(
  id: string,
  type: string,
  raw: Record<string, unknown> = {},
  pos: { x: number; y: number } = { x: 0, y: 0 },
  size: { w?: number; h?: number } = {},
): Node<GcNodeData> {
  return {
    id,
    type: "gcNode",
    position: pos,
    data: { graphNodeType: type, label: id, raw },
    width: size.w,
    height: size.h,
  } as Node<GcNodeData>;
}

describe("isNodeMuted / selectionAllMuted", () => {
  it("returns false when gcMuted is not set", () => {
    expect(isNodeMuted(makeNode("a", "task"))).toBe(false);
  });
  it("returns true when gcMuted is true", () => {
    expect(isNodeMuted(makeNode("a", "task", { gcMuted: true }))).toBe(true);
  });
  it("selectionAllMuted is false when at least one selected node is not muted", () => {
    const nodes = [
      makeNode("a", "task", { gcMuted: true }),
      makeNode("b", "task"),
      makeNode("c", "task", { gcMuted: true }),
    ];
    expect(selectionAllMuted(nodes, new Set(["a", "b", "c"]))).toBe(false);
  });
  it("selectionAllMuted is true when every selected node is muted", () => {
    const nodes = [
      makeNode("a", "task", { gcMuted: true }),
      makeNode("b", "task", { gcMuted: true }),
    ];
    expect(selectionAllMuted(nodes, new Set(["a", "b"]))).toBe(true);
  });
  it("selectionAllMuted is false for an empty selection", () => {
    expect(selectionAllMuted([], new Set())).toBe(false);
  });
});

describe("applyToggleMuteOnSelection", () => {
  it("mutes all selected when any is unmuted", () => {
    const nodes = [
      makeNode("a", "task"),
      makeNode("b", "task", { gcMuted: true }),
      makeNode("c", "task"), // not selected
    ];
    const out = applyToggleMuteOnSelection(nodes, new Set(["a", "b"]));
    expect(out.find((n) => n.id === "a")!.data.raw.gcMuted).toBe(true);
    expect(out.find((n) => n.id === "b")!.data.raw.gcMuted).toBe(true);
    expect(out.find((n) => n.id === "c")!.data.raw.gcMuted).toBeUndefined();
  });
  it("unmutes all selected when every selected is currently muted", () => {
    const nodes = [
      makeNode("a", "task", { gcMuted: true }),
      makeNode("b", "task", { gcMuted: true }),
    ];
    const out = applyToggleMuteOnSelection(nodes, new Set(["a", "b"]));
    expect(out.find((n) => n.id === "a")!.data.raw.gcMuted).toBeUndefined();
    expect(out.find((n) => n.id === "b")!.data.raw.gcMuted).toBeUndefined();
  });
});

describe("applyDuplicateSelection", () => {
  it("adds clones with the configured (40, 40) offset and skips the start node", () => {
    const nodes = [
      makeNode("start", "start", {}, { x: 0, y: 0 }),
      makeNode("a", "task", {}, { x: 100, y: 100 }),
      makeNode("b", "task", {}, { x: 200, y: 200 }),
    ];
    let counter = 0;
    const result = applyDuplicateSelection(
      nodes,
      new Set(["start", "a", "b"]),
      { newNodeId: () => `dup-${++counter}` },
    );
    expect(result.mappings.map((m) => m.sourceId).sort()).toEqual(["a", "b"]);
    expect(result.nodes.find((n) => n.id === "dup-1")!.position).toEqual({
      x: 100 + BULK_DUPLICATE_OFFSET.x,
      y: 100 + BULK_DUPLICATE_OFFSET.y,
    });
    expect(result.nodes.find((n) => n.id === "dup-2")!.position).toEqual({
      x: 200 + BULK_DUPLICATE_OFFSET.x,
      y: 200 + BULK_DUPLICATE_OFFSET.y,
    });
    // Original 'a' should be deselected, clones selected.
    expect(result.nodes.find((n) => n.id === "dup-1")!.selected).toBe(true);
    expect(result.nodes.find((n) => n.id === "a")!.selected).toBeFalsy();
  });

  it("returns input unchanged when nothing is eligible", () => {
    const nodes = [makeNode("start", "start")];
    const result = applyDuplicateSelection(
      nodes,
      new Set(["start"]),
      { newNodeId: () => "dup" },
    );
    expect(result.mappings).toEqual([]);
    expect(result.nodes).toHaveLength(1);
  });
});

describe("bulkSelectionBBox + applyGroupSelectionIntoSticky", () => {
  it("computes a bbox over selected node positions and sizes", () => {
    const nodes = [
      makeNode("a", "task", {}, { x: 0, y: 0 }, { w: 100, h: 40 }),
      makeNode("b", "task", {}, { x: 200, y: 100 }, { w: 120, h: 60 }),
    ];
    const box = bulkSelectionBBox(nodes, new Set(["a", "b"]));
    expect(box).toEqual({ x: 0, y: 0, width: 320, height: 160 });
  });

  it("prepends a sticky frame sized to bbox + padding when grouping", () => {
    const nodes = [
      makeNode("a", "task", {}, { x: 0, y: 0 }, { w: 100, h: 40 }),
      makeNode("b", "task", {}, { x: 200, y: 100 }, { w: 120, h: 60 }),
    ];
    const next = applyGroupSelectionIntoSticky(
      nodes,
      new Set(["a", "b"]),
      { newNodeId: () => "sticky-1" },
    );
    expect(next).not.toBeNull();
    const sticky = next![0];
    expect(sticky.id).toBe("sticky-1");
    expect(sticky.type).toBe("gcComment");
    expect(sticky.position).toEqual({
      x: -BULK_STICKY_PADDING_PX,
      y: -BULK_STICKY_PADDING_PX,
    });
    expect(sticky.data.raw.width).toBe(320 + BULK_STICKY_PADDING_PX * 2);
    expect(sticky.data.raw.height).toBe(160 + BULK_STICKY_PADDING_PX * 2);
  });
});
