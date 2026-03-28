// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import { collectCanvasWarningEdgeIds } from "./warningEdges";
import type { GraphDocumentJson } from "./types";

describe("collectCanvasWarningEdgeIds", () => {
  it("merges handle issues and branch template edge ids", () => {
    const doc: GraphDocumentJson = {
      schemaVersion: 1,
      meta: { schemaVersion: 1, graphId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", title: "t" },
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "t1", type: "task", position: { x: 0, y: 0 }, data: { command: "echo" } },
      ],
      edges: [
        {
          id: "e_bad_handle",
          source: "s1",
          sourceHandle: "out_error",
          target: "t1",
          targetHandle: "in_default",
          condition: "{{x",
        },
      ],
    };
    const ids = collectCanvasWarningEdgeIds(doc, []);
    expect(ids.has("e_bad_handle")).toBe(true);
  });
});
