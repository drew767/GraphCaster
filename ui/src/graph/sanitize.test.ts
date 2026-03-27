// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import { sanitizeGraphConnectivity } from "./sanitize";
import type { GraphDocumentJson } from "./types";

function doc(
  partial: Omit<GraphDocumentJson, "schemaVersion" | "meta" | "viewport"> &
    Partial<Pick<GraphDocumentJson, "viewport">>,
): GraphDocumentJson {
  return {
    schemaVersion: 1,
    meta: { schemaVersion: 1, graphId: "ffffffff-ffff-4fff-8fff-ffffffffffff", title: "t" },
    viewport: partial.viewport ?? { x: 0, y: 0, zoom: 1 },
    ...partial,
  };
}

describe("sanitizeGraphConnectivity", () => {
  it("drops edges whose source or target is missing and lists removed ids", () => {
    const g = doc({
      nodes: [{ id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} }],
      edges: [
        {
          id: "bad",
          source: "s1",
          sourceHandle: "out_default",
          target: "ghost",
          targetHandle: "in_default",
          condition: null,
        },
      ],
    });
    const { document, removedEdgeIds } = sanitizeGraphConnectivity(g);
    expect(document.edges).toEqual([]);
    expect(removedEdgeIds).toEqual(["bad"]);
  });

  it("keeps valid edges and returns empty removed list", () => {
    const g = doc({
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "e1", type: "exit", position: { x: 0, y: 0 }, data: {} },
      ],
      edges: [
        {
          id: "ok",
          source: "s1",
          sourceHandle: "out_default",
          target: "e1",
          targetHandle: "in_default",
          condition: null,
        },
      ],
    });
    const { document, removedEdgeIds } = sanitizeGraphConnectivity(g);
    expect(removedEdgeIds).toEqual([]);
    expect(document.edges?.length).toBe(1);
  });
});
