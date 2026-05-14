// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";
import { collectUpstreamNodes } from "../upstream_collector";
import type { GraphDocumentJson } from "../../../graph/types";

const simpleDoc: GraphDocumentJson = {
  schemaVersion: 1,
  nodes: [
    { id: "start1", type: "start", position: { x: 0, y: 0 } },
    { id: "task1", type: "task", position: { x: 100, y: 0 } },
    { id: "task2", type: "task", position: { x: 200, y: 0 } },
    { id: "agent1", type: "agent", position: { x: 300, y: 0 } },
  ],
  edges: [
    { id: "e1", source: "start1", target: "task1", sourceHandle: "out_default" },
    { id: "e2", source: "task1", target: "task2", sourceHandle: "out_default" },
    { id: "e3", source: "task2", target: "agent1", sourceHandle: "out_custom" },
  ],
};

describe("collectUpstreamNodes", () => {
  it("returns all ancestors up to start for a leaf node", () => {
    const result = collectUpstreamNodes(simpleDoc, "agent1");
    const ids = result.map((n) => n.id).sort();
    expect(ids).toEqual(["start1", "task1", "task2"]);
  });

  it("does not include the current node itself", () => {
    const result = collectUpstreamNodes(simpleDoc, "task2");
    const ids = result.map((n) => n.id);
    expect(ids).not.toContain("task2");
  });

  it("returns empty for start node", () => {
    const result = collectUpstreamNodes(simpleDoc, "start1");
    expect(result).toHaveLength(0);
  });

  it("includes correct outputs from sourceHandle on edges", () => {
    const result = collectUpstreamNodes(simpleDoc, "agent1");
    const task2 = result.find((n) => n.id === "task2");
    expect(task2).toBeDefined();
    expect(task2!.outputs).toContain("out_custom");
  });

  it("falls back to out_default when no sourceHandle is present", () => {
    const docNoHandle: GraphDocumentJson = {
      schemaVersion: 1,
      nodes: [
        { id: "a", type: "start", position: { x: 0, y: 0 } },
        { id: "b", type: "task", position: { x: 100, y: 0 } },
      ],
      edges: [{ id: "e1", source: "a", target: "b" }],
    };
    const result = collectUpstreamNodes(docNoHandle, "b");
    expect(result[0].outputs).toEqual(["out_default"]);
  });

  it("skips frame nodes (comment, group)", () => {
    const docWithFrame: GraphDocumentJson = {
      schemaVersion: 1,
      nodes: [
        { id: "s", type: "start", position: { x: 0, y: 0 } },
        { id: "frame", type: "comment", position: { x: 50, y: 0 } },
        { id: "target", type: "task", position: { x: 100, y: 0 } },
      ],
      edges: [
        { id: "e1", source: "s", target: "frame" },
        { id: "e2", source: "frame", target: "target" },
      ],
    };
    const result = collectUpstreamNodes(docWithFrame, "target");
    const ids = result.map((n) => n.id);
    expect(ids).not.toContain("frame");
    expect(ids).toContain("s");
  });

  it("includes node type in the result", () => {
    const result = collectUpstreamNodes(simpleDoc, "agent1");
    const task1 = result.find((n) => n.id === "task1");
    expect(task1?.type).toBe("task");
  });
});
