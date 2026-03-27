// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, vi } from "vitest";

import {
  buildClipboardPayload,
  GRAPH_CASTER_CLIPBOARD_KIND,
  mergePastedSubgraph,
  parseClipboardPayload,
} from "./clipboard";
import type { GraphDocumentJson } from "./types";

describe("buildClipboardPayload", () => {
  it("returns induced subgraph with internal edges only", () => {
    const doc: GraphDocumentJson = {
      nodes: [
        { id: "a", type: "task", position: { x: 0, y: 0 }, data: {} },
        { id: "b", type: "task", position: { x: 100, y: 0 }, data: {} },
        { id: "c", type: "exit", position: { x: 200, y: 0 }, data: {} },
      ],
      edges: [
        { id: "e1", source: "a", target: "b", sourceHandle: "out default", targetHandle: "in default" },
        { id: "e2", source: "b", target: "c", sourceHandle: "out default", targetHandle: "in default" },
      ],
    };
    const p = buildClipboardPayload(doc, new Set(["a", "b"]));
    expect(p).not.toBeNull();
    expect(p!.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
    expect(p!.edges.map((e) => e.id)).toEqual(["e1"]);
  });

  it("excludes start nodes from clipboard", () => {
    const doc: GraphDocumentJson = {
      nodes: [
        { id: "s", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "t", type: "task", position: { x: 10, y: 0 }, data: {} },
      ],
      edges: [],
    };
    expect(buildClipboardPayload(doc, new Set(["s"]))).toBeNull();
    const p = buildClipboardPayload(doc, new Set(["s", "t"]));
    expect(p!.nodes.map((n) => n.id)).toEqual(["t"]);
  });
});

describe("mergePastedSubgraph", () => {
  it("remaps node and edge ids and offsets positions", () => {
    const base: GraphDocumentJson = {
      nodes: [{ id: "x", type: "task", position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    };
    const payload = {
      kind: GRAPH_CASTER_CLIPBOARD_KIND,
      schemaVersion: 1,
      nodes: [
        { id: "a", type: "task", position: { x: 5, y: 7 }, data: { title: "A" } },
        { id: "b", type: "task", position: { x: 15, y: 7 }, data: {} },
      ],
      edges: [
        {
          id: "e0",
          source: "a",
          target: "b",
          sourceHandle: "out_default",
          targetHandle: "in_default",
        },
      ],
    };
    let n = 0;
    let e = 0;
    const out = mergePastedSubgraph(base, payload, {
      newNodeId: () => `nn-${++n}`,
      newEdgeId: () => `ee-${++e}`,
      positionOffset: { x: 10, y: 20 },
    });
    expect(out.nodes?.map((node) => node.id).sort()).toEqual(["nn-1", "nn-2", "x"]);
    const na = out.nodes?.find((node) => node.id === "nn-1");
    const nb = out.nodes?.find((node) => node.id === "nn-2");
    expect(na?.position).toEqual({ x: 15, y: 27 });
    expect(nb?.position).toEqual({ x: 25, y: 27 });
    const ed = out.edges?.find((edge) => edge.id === "ee-1");
    expect(ed?.source).toBe("nn-1");
    expect(ed?.target).toBe("nn-2");
  });

  it("returns base unchanged when payload has duplicate node ids", () => {
    const base: GraphDocumentJson = {
      nodes: [{ id: "x", type: "task", position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    };
    const payload = {
      kind: GRAPH_CASTER_CLIPBOARD_KIND,
      schemaVersion: 1,
      nodes: [
        { id: "a", type: "task", position: { x: 0, y: 0 }, data: {} },
        { id: "a", type: "task", position: { x: 1, y: 1 }, data: {} },
      ],
      edges: [],
    };
    const out = mergePastedSubgraph(base, payload, {
      newNodeId: () => "n-new",
      newEdgeId: () => "e-new",
      positionOffset: { x: 0, y: 0 },
    });
    expect(out).toBe(base);
  });

  it("drops edges that cannot be remapped to new node ids", () => {
    const base: GraphDocumentJson = {
      nodes: [{ id: "x", type: "task", position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    };
    const payload = {
      kind: GRAPH_CASTER_CLIPBOARD_KIND,
      schemaVersion: 1,
      nodes: [{ id: "a", type: "task", position: { x: 0, y: 0 }, data: {} }],
      edges: [
        {
          id: "e0",
          source: "orphan",
          target: "a",
          sourceHandle: "out_default",
          targetHandle: "in_default",
        },
      ],
    };
    const out = mergePastedSubgraph(base, payload, {
      newNodeId: () => "nn-1",
      newEdgeId: () => "ee-1",
      positionOffset: { x: 0, y: 0 },
    });
    expect(out.nodes?.map((n) => n.id).sort()).toEqual(["nn-1", "x"]);
    expect(out.edges ?? []).toEqual([]);
  });

  it("does not paste second start when document already has start", () => {
    const base: GraphDocumentJson = {
      nodes: [{ id: "s0", type: "start", position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    };
    const payload = {
      kind: GRAPH_CASTER_CLIPBOARD_KIND,
      schemaVersion: 1,
      nodes: [
        { id: "s1", type: "start", position: { x: 1, y: 1 }, data: {} },
        { id: "t1", type: "task", position: { x: 2, y: 2 }, data: {} },
      ],
      edges: [],
    };
    const out = mergePastedSubgraph(base, payload, {
      newNodeId: vi.fn(() => "n-new"),
      newEdgeId: vi.fn(() => "e-new"),
      positionOffset: { x: 0, y: 0 },
    });
    expect(out.nodes?.some((node) => node.type === "start" && node.id !== "s0")).toBe(false);
    expect(out.nodes?.some((node) => node.id === "n-new")).toBe(true);
  });
});

describe("parseClipboardPayload", () => {
  it("accepts valid JSON", () => {
    const p = {
      kind: GRAPH_CASTER_CLIPBOARD_KIND,
      schemaVersion: 1,
      nodes: [],
      edges: [],
    };
    expect(parseClipboardPayload(JSON.stringify(p))).toEqual(p);
  });

  it("rejects wrong kind", () => {
    expect(parseClipboardPayload(JSON.stringify({ kind: "other", nodes: [], edges: [] }))).toBeNull();
  });
});
