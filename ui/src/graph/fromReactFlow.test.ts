// Copyright GraphCaster. All Rights Reserved.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { edgeCanvasLabelText, flowEdgeLabelToCondition } from "./edgeCanvasLabel";
import { flowToDocument } from "./fromReactFlow";
import type { GraphDocumentJson } from "./types";
import { GC_FLOW_EDGE_TYPE_BRANCH, graphDocumentToFlow } from "./toReactFlow";

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "schemas",
  "test-fixtures",
);

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

  it("orders exported JSON nodes parents before children", () => {
    const base: GraphDocumentJson = {
      schemaVersion: 1,
      meta: { schemaVersion: 1, graphId: "ord-test" },
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        { id: "child", type: "task", position: { x: 5, y: 5 }, parentId: "frame", data: { title: "T" } },
        { id: "frame", type: "group", position: { x: 0, y: 0 }, data: { title: "G", width: 200, height: 200 } },
      ],
      edges: [],
    };
    const { nodes, edges } = graphDocumentToFlow(base);
    const doc = flowToDocument(nodes, edges, base);
    const ids = (doc.nodes ?? []).map((n) => n.id);
    expect(ids.indexOf("frame")).toBeLessThan(ids.indexOf("child"));
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

  it("assigns gcBranch edge type for custom edge labels", () => {
    const { edges } = graphDocumentToFlow({
      nodes: [
        { id: "a", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "b", type: "task", position: { x: 100, y: 0 }, data: {} },
      ],
      edges: [
        {
          id: "e",
          source: "a",
          target: "b",
          sourceHandle: "out_default",
          targetHandle: "in_default",
          condition: "true",
        },
      ],
    });
    expect(edges).toHaveLength(1);
    expect(edges[0]?.type).toBe(GC_FLOW_EDGE_TYPE_BRANCH);
  });

  it("roundtrips edge.data.routeDescription through flow export", () => {
    const raw = JSON.parse(readFileSync(join(FIXTURE_DIR, "ai-route-simple.json"), "utf8")) as GraphDocumentJson;
    const { nodes, edges } = graphDocumentToFlow(raw);
    const back = flowToDocument(nodes, edges, raw);
    const e1 = back.edges?.find((e) => e.id === "e1");
    expect(e1?.data?.routeDescription).toBe("Left exit");
    const e2 = back.edges?.find((e) => e.id === "e2");
    expect(e2?.data?.routeDescription).toBe("Right exit");
  });

  it("roundtrips edge.data F18 port kind overrides through flow export", () => {
    const doc: GraphDocumentJson = {
      schemaVersion: 1,
      nodes: [
        { id: "a", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "b", type: "task", position: { x: 100, y: 0 }, data: {} },
      ],
      edges: [
        {
          id: "e1",
          source: "a",
          target: "b",
          sourceHandle: "out_default",
          targetHandle: "in_default",
          data: { sourcePortKind: "json", targetPortKind: "primitive" },
        },
      ],
    };
    const { nodes, edges } = graphDocumentToFlow(doc);
    const back = flowToDocument(nodes, edges, doc);
    const e1 = back.edges?.find((e) => e.id === "e1");
    expect(e1?.data?.sourcePortKind).toBe("json");
    expect(e1?.data?.targetPortKind).toBe("primitive");
  });

  it("ai_route document edge maps to canvas pill text via routeDescription", () => {
    const { edges } = graphDocumentToFlow({
      nodes: [
        { id: "r", type: "ai_route", position: { x: 0, y: 0 }, data: { title: "Route" } },
        { id: "t", type: "task", position: { x: 100, y: 0 }, data: {} },
      ],
      edges: [
        {
          id: "e",
          source: "r",
          target: "t",
          sourceHandle: "out_default",
          targetHandle: "in_default",
          condition: "cond",
          data: { routeDescription: "North branch" },
        },
      ],
    });
    const e = edges[0]!;
    expect(e.type).toBe(GC_FLOW_EDGE_TYPE_BRANCH);
    const rd =
      e.data != null &&
      typeof e.data === "object" &&
      !Array.isArray(e.data) &&
      typeof (e.data as { routeDescription?: unknown }).routeDescription === "string"
        ? (e.data as { routeDescription: string }).routeDescription
        : "";
    const pill = edgeCanvasLabelText({
      condition: flowEdgeLabelToCondition(e.label),
      routeDescription: rd,
      sourceIsAiRoute: true,
      branchFallbackLabel: "Branch",
    });
    expect(pill).toBe("North branch");
  });
});
