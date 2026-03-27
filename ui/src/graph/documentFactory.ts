// Copyright GraphCaster. All Rights Reserved.

import type { GraphDocumentJson } from "./types";

function newGraphId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `graph-${Date.now()}`;
}

export function createMinimalGraphDocument(): GraphDocumentJson {
  return {
    schemaVersion: 1,
    meta: {
      schemaVersion: 1,
      graphId: newGraphId(),
      title: "Untitled",
    },
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      { id: "start1", type: "start", position: { x: 120, y: 200 }, data: {} },
      {
        id: "exit1",
        type: "exit",
        position: { x: 420, y: 200 },
        data: { title: "Done" },
      },
    ],
    edges: [
      {
        id: "e1",
        source: "start1",
        target: "exit1",
        sourceHandle: "out_default",
        targetHandle: "in_default",
        condition: null,
      },
    ],
  };
}
