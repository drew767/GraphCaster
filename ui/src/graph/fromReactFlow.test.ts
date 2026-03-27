// Copyright Aura. All Rights Reserved.

import { describe, expect, it } from "vitest";

import { flowToDocument } from "./fromReactFlow";
import type { GraphDocumentJson } from "./types";

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
});
