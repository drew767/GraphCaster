// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import { flowToDocument } from "./fromReactFlow";
import type { GraphDocumentJson } from "./types";
import { graphDocumentToFlow } from "./toReactFlow";

describe("flowToDocument", () => {
  it("writes one schemaVersion from meta first then root (Python parity)", () => {
    const base: GraphDocumentJson = {
      schemaVersion: 9,
      meta: { schemaVersion: 2, graphId: "gg" },
      nodes: [],
      edges: [],
    };
    const doc = flowToDocument([], [], base);
    expect(doc.schemaVersion).toBe(2);
    expect(doc.meta?.schemaVersion).toBe(2);
  });

  it("falls back to root when meta schemaVersion absent", () => {
    const base: GraphDocumentJson = {
      schemaVersion: 7,
      meta: { graphId: "hh" },
      nodes: [],
      edges: [],
    };
    const doc = flowToDocument([], [], base);
    expect(doc.schemaVersion).toBe(7);
    expect(doc.meta?.schemaVersion).toBe(7);
  });

  it("preserves inputs and outputs from base", () => {
    const base: GraphDocumentJson = {
      meta: { graphId: "x" },
      inputs: [{ name: "a" }],
      outputs: { result: "string" },
      nodes: [],
      edges: [],
    };
    const doc = flowToDocument([], [], base);
    expect(doc.inputs).toEqual([{ name: "a" }]);
    expect(doc.outputs).toEqual({ result: "string" });
  });
});

describe("graphDocumentToFlow", () => {
  it("marks start node as not deletable", () => {
    const { nodes } = graphDocumentToFlow({
      nodes: [{ id: "s", type: "start", position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.deletable).toBe(false);
  });

  it("marks task node as deletable", () => {
    const { nodes } = graphDocumentToFlow({
      nodes: [{ id: "t", type: "task", position: { x: 0, y: 0 }, data: {} }],
      edges: [],
    });
    expect(nodes[0]?.deletable).toBe(true);
  });
});
