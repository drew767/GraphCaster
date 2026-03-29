// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import { flowToDocument } from "./fromReactFlow";
import { applyGroupSelection, applyUngroupSelection, computeGroupFrameBounds } from "./groupSelection";
import { graphDocumentToFlow } from "./toReactFlow";
import type { GraphDocumentJson } from "./types";

function minimalDoc(): GraphDocumentJson {
  return {
    schemaVersion: 1,
    meta: { schemaVersion: 1, graphId: "test-graph", title: "t" },
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      { id: "s", type: "start", position: { x: 0, y: 0 }, data: {} },
      { id: "a", type: "task", position: { x: 100, y: 100 }, data: { title: "A" } },
      { id: "b", type: "task", position: { x: 250, y: 180 }, data: { title: "B" } },
    ],
    edges: [],
  };
}

describe("groupSelection", () => {
  it("graphDocumentToFlow sets parentId when parent type is group", () => {
    const doc: GraphDocumentJson = {
      ...minimalDoc(),
      nodes: [
        {
          id: "gr",
          type: "group",
          position: { x: 0, y: 0 },
          data: { title: "G", width: 400, height: 300 },
        },
        {
          id: "t1",
          type: "task",
          position: { x: 40, y: 40 },
          parentId: "gr",
          data: { title: "T" },
        },
      ],
    };
    const { nodes } = graphDocumentToFlow(doc);
    const t = nodes.find((n) => n.id === "t1");
    expect(t?.parentId).toBe("gr");
  });

  it("computeGroupFrameBounds is null for fewer than two eligible nodes", () => {
    const { nodes } = graphDocumentToFlow(minimalDoc());
    expect(computeGroupFrameBounds(nodes, new Set(["a"]))).toBe(null);
  });

  it("applyGroupSelection wraps two tasks and round-trips", () => {
    const doc = minimalDoc();
    const { nodes, edges } = graphDocumentToFlow(doc);
    const applied = applyGroupSelection(nodes, new Set(["a", "b"]));
    expect(applied).not.toBe(null);
    const a = applied!.nodes.find((n) => n.id === "a");
    const b = applied!.nodes.find((n) => n.id === "b");
    const g = applied!.nodes.find((n) => n.id === applied!.groupId);
    expect(a?.parentId).toBe(applied!.groupId);
    expect(b?.parentId).toBe(applied!.groupId);
    expect(g?.type).toBe("gcGroup");

    const out = flowToDocument(applied!.nodes, edges, doc);
    const gn = out.nodes?.find((n) => n.type === "group");
    expect(gn).toBeDefined();
    const ta = out.nodes?.find((n) => n.id === "a");
    expect(ta?.parentId).toBe(gn?.id);
  });

  it("applyUngroupSelection removes group and restores root positions", () => {
    const doc = minimalDoc();
    const origA = { ...doc.nodes!.find((n) => n.id === "a")!.position! };
    const origB = { ...doc.nodes!.find((n) => n.id === "b")!.position! };
    const { nodes, edges } = graphDocumentToFlow(doc);
    const applied = applyGroupSelection(nodes, new Set(["a", "b"]))!;
    const ungrouped = applyUngroupSelection(applied.nodes, applied.groupId);
    expect(ungrouped).not.toBe(null);
    const out = flowToDocument(ungrouped!, edges, doc);
    expect(out.nodes?.some((n) => n.type === "group")).toBe(false);
    const ta = out.nodes?.find((n) => n.id === "a");
    const tb = out.nodes?.find((n) => n.id === "b");
    expect(ta?.parentId).toBeUndefined();
    expect(tb?.parentId).toBeUndefined();
    expect(ta?.position).toEqual(origA);
    expect(tb?.position).toEqual(origB);
  });

  it("group inside comment keeps parentId and absolute positions after ungroup", () => {
    const doc: GraphDocumentJson = {
      schemaVersion: 1,
      meta: { schemaVersion: 1, graphId: "test-graph", title: "t" },
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        {
          id: "fr",
          type: "comment",
          position: { x: 400, y: 300 },
          data: { title: "Frame", width: 500, height: 400 },
        },
        { id: "a", type: "task", position: { x: 450, y: 350 }, parentId: "fr", data: { title: "A" } },
        { id: "b", type: "task", position: { x: 620, y: 420 }, parentId: "fr", data: { title: "B" } },
      ],
      edges: [],
    };
    const origA = { ...doc.nodes!.find((n) => n.id === "a")!.position! };
    const origB = { ...doc.nodes!.find((n) => n.id === "b")!.position! };
    const { nodes, edges } = graphDocumentToFlow(doc);
    const applied = applyGroupSelection(nodes, new Set(["a", "b"]));
    expect(applied).not.toBe(null);
    expect(applied!.nodes.find((n) => n.id === applied!.groupId)?.parentId).toBe("fr");
    const ungrouped = applyUngroupSelection(applied!.nodes, applied!.groupId)!;
    const out = flowToDocument(ungrouped, edges, doc);
    expect(out.nodes?.some((n) => n.type === "group")).toBe(false);
    const ta = out.nodes?.find((n) => n.id === "a");
    const tb = out.nodes?.find((n) => n.id === "b");
    expect(ta?.parentId).toBe("fr");
    expect(tb?.parentId).toBe("fr");
    expect(ta?.position).toEqual(origA);
    expect(tb?.position).toEqual(origB);
  });
});
