// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import { graphIdFromDocument, parseGraphDocumentJson, parseGraphDocumentJsonResult } from "./parseDocument";

describe("parseGraphDocumentJson", () => {
  it("returns null for non-object root", () => {
    expect(parseGraphDocumentJson(null)).toBeNull();
    expect(parseGraphDocumentJson([])).toBeNull();
  });

  it("defaults missing nodes and edges to empty arrays", () => {
    const doc = parseGraphDocumentJson({
      meta: { schemaVersion: 1, graphId: "11111111-1111-4111-8111-111111111111" },
    });
    expect(doc).not.toBeNull();
    expect(doc!.nodes).toEqual([]);
    expect(doc!.edges).toEqual([]);
  });

  it("normalizes graphId 0 to string in meta", () => {
    const doc = parseGraphDocumentJson({
      meta: { schemaVersion: 1, graphId: 0 },
      nodes: [],
      edges: [],
    });
    expect(doc).not.toBeNull();
    expect(doc!.meta?.graphId).toBe("0");
    expect(graphIdFromDocument(doc!)).toBe("0");
  });

  it("normalizes edge handles and drops snake_case keys", () => {
    const doc = parseGraphDocumentJson({
      meta: { schemaVersion: 1, graphId: "g" },
      nodes: [
        { id: "a", type: "start", position: {}, data: {} },
        { id: "b", type: "exit", position: {}, data: {} },
      ],
      edges: [
        {
          id: "e1",
          source: "a",
          target: "b",
          sourceHandle: "",
          source_handle: "alt",
        },
      ],
    });
    expect(doc!.edges![0].sourceHandle).toBe("alt");
    expect((doc!.edges![0] as Record<string, unknown>).source_handle).toBeUndefined();
  });
});

describe("parseGraphDocumentJsonResult", () => {
  it("returns not_object for null root", () => {
    const r = parseGraphDocumentJsonResult(null);
    expect(r.ok).toBe(false);
    if (r.ok) {
      return;
    }
    expect(r.error).toEqual({ kind: "not_object" });
  });

  it("returns nodes_not_array when nodes is string", () => {
    const r = parseGraphDocumentJsonResult({
      meta: { schemaVersion: 1, graphId: "g" },
      nodes: "bad",
      edges: [],
    });
    expect(r.ok).toBe(false);
    if (r.ok) {
      return;
    }
    expect(r.error).toEqual({ kind: "nodes_not_array" });
  });

  it("returns invalid_node with index when node id missing", () => {
    const r = parseGraphDocumentJsonResult({
      meta: { schemaVersion: 1, graphId: "g" },
      nodes: [{ id: "" }],
      edges: [],
    });
    expect(r.ok).toBe(false);
    if (r.ok) {
      return;
    }
    expect(r.error).toEqual({ kind: "invalid_node", index: 0, reason: "id" });
  });
});
