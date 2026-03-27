// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import { buildCanvasNodeSearchRows, filterCanvasNodeSearchRows } from "./canvasNodeSearch";
import type { GraphDocumentJson } from "./types";

function doc(nodes: GraphDocumentJson["nodes"]): GraphDocumentJson {
  return { schemaVersion: 1, nodes: nodes ?? [], edges: [] };
}

describe("buildCanvasNodeSearchRows", () => {
  it("sorts by id", () => {
    const rows = buildCanvasNodeSearchRows(
      doc([
        { id: "b", type: "task", data: {} },
        { id: "a", type: "start", data: {} },
      ]),
    );
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("skips nodes without id", () => {
    const rows = buildCanvasNodeSearchRows(
      doc([{ id: "", type: "task", data: {} }, { id: "x", type: "task" }]),
    );
    expect(rows.map((r) => r.id)).toEqual(["x"]);
  });

  it("includes graphId in searchable text", () => {
    const rows = buildCanvasNodeSearchRows(
      doc([
        {
          id: "g1",
          type: "graph_ref",
          data: { graphId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
        },
      ]),
    );
    expect(rows).toHaveLength(1);
    const filtered = filterCanvasNodeSearchRows(rows, "bbbb");
    expect(filtered.map((r) => r.id)).toEqual(["g1"]);
  });

  it("includes targetGraphId in searchable text", () => {
    const rows = buildCanvasNodeSearchRows(
      doc([
        {
          id: "g2",
          type: "graph_ref",
          data: { targetGraphId: "11111111-2222-3333-4444-555555555555" },
        },
      ]),
    );
    expect(rows).toHaveLength(1);
    const filtered = filterCanvasNodeSearchRows(rows, "3333");
    expect(filtered.map((r) => r.id)).toEqual(["g2"]);
  });

  it("matches task type substring in searchable text", () => {
    const rows = buildCanvasNodeSearchRows(doc([{ id: "n1", type: "task", data: { title: "Do work" } }]));
    const filtered = filterCanvasNodeSearchRows(rows, "tas");
    expect(filtered.map((r) => r.id)).toEqual(["n1"]);
  });

  it("matches display title", () => {
    const rows = buildCanvasNodeSearchRows(doc([{ id: "x", type: "exit", data: { title: "Done" } }]));
    expect(filterCanvasNodeSearchRows(rows, "done")).toHaveLength(1);
  });
});

describe("filterCanvasNodeSearchRows", () => {
  it("empty query returns all rows in order", () => {
    const rows = buildCanvasNodeSearchRows(
      doc([
        { id: "m", type: "merge", data: {} },
        { id: "s", type: "start", data: {} },
      ]),
    );
    const out = filterCanvasNodeSearchRows(rows, "");
    expect(out.map((r) => r.id)).toEqual(["m", "s"]);
  });
});
