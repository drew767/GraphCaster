// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import {
  buildGraphRefSnapshotFromParsed,
  parseGraphRefSnapshotFromJsonText,
} from "./graphRefLazySnapshot";
import type { GraphDocumentJson } from "./types";

describe("buildGraphRefSnapshotFromParsed", () => {
  it("returns node count and title from meta", () => {
    const doc: GraphDocumentJson = {
      schemaVersion: 1,
      nodes: [{ id: "a", type: "start", data: {} }],
      edges: [],
      meta: { title: "Child A" },
    };
    const s = buildGraphRefSnapshotFromParsed(doc);
    expect(s.title).toBe("Child A");
    expect(s.workflowNodeCount).toBe(1);
    expect(s.schemaVersion).toBe(1);
    expect(s.hasStart).toBe(true);
  });

  it("reports hasStart false without start node", () => {
    const doc: GraphDocumentJson = {
      nodes: [{ id: "t1", type: "task", data: {} }],
      edges: [],
    };
    expect(buildGraphRefSnapshotFromParsed(doc).hasStart).toBe(false);
  });
});

describe("parseGraphRefSnapshotFromJsonText", () => {
  it("returns json error for invalid JSON", () => {
    const r = parseGraphRefSnapshotFromJsonText("{");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errorKind).toBe("json");
    }
  });

  it("returns parse_doc when not a graph document", () => {
    const r = parseGraphRefSnapshotFromJsonText(JSON.stringify({ nodes: "not-array" }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errorKind).toBe("parse_doc");
    }
  });

  it("returns snapshot for minimal valid graph JSON string", () => {
    const r = parseGraphRefSnapshotFromJsonText(
      JSON.stringify({
        schemaVersion: 1,
        nodes: [{ id: "s", type: "start", data: {} }],
        edges: [],
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.snapshot.workflowNodeCount).toBe(1);
      expect(r.snapshot.hasStart).toBe(true);
    }
  });
});
