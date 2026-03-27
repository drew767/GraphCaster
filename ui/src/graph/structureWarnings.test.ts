// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import {
  findStructureIssues,
  structureIssuesBlockRun,
  type StructureIssue,
} from "./structureWarnings";
import type { GraphDocumentJson } from "./types";

function doc(partial: Omit<GraphDocumentJson, "schemaVersion" | "meta" | "viewport"> & Partial<Pick<GraphDocumentJson, "viewport">>): GraphDocumentJson {
  return {
    schemaVersion: 1,
    meta: { schemaVersion: 1, graphId: "ffffffff-ffff-4fff-8fff-ffffffffffff", title: "t" },
    viewport: partial.viewport ?? { x: 0, y: 0, zoom: 1 },
    ...partial,
  };
}

describe("structureIssuesBlockRun", () => {
  it("is false when only unreachable_nodes", () => {
    const issues: StructureIssue[] = [{ kind: "unreachable_nodes", ids: ["x"] }];
    expect(structureIssuesBlockRun(issues)).toBe(false);
  });

  it("is true for no_start", () => {
    expect(structureIssuesBlockRun([{ kind: "no_start" }])).toBe(true);
  });

  it("is true when unreachable is combined with a blocking issue", () => {
    const issues: StructureIssue[] = [
      { kind: "unreachable_nodes", ids: ["x"] },
      { kind: "no_start" },
    ];
    expect(structureIssuesBlockRun(issues)).toBe(true);
  });

  it("is true for start_has_incoming and multiple_starts", () => {
    expect(structureIssuesBlockRun([{ kind: "start_has_incoming", startId: "s" }])).toBe(true);
    expect(
      structureIssuesBlockRun([{ kind: "multiple_starts", ids: ["a", "b"] }]),
    ).toBe(true);
  });

  it("is false when only merge_few_inputs", () => {
    expect(
      structureIssuesBlockRun([{ kind: "merge_few_inputs", nodeId: "m1", incomingEdges: 1 }]),
    ).toBe(false);
  });
});

describe("findStructureIssues", () => {
  it("adds unreachable_nodes for orphan non-comment node", () => {
    const g = doc({
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "t1", type: "task", position: { x: 0, y: 0 }, data: {} },
        { id: "orphan", type: "task", position: { x: 0, y: 0 }, data: {} },
      ],
      edges: [
        {
          id: "e1",
          source: "s1",
          sourceHandle: "out_default",
          target: "t1",
          targetHandle: "in_default",
          condition: null,
        },
      ],
    });
    const issues = findStructureIssues(g);
    expect(issues.some((i) => i.kind === "unreachable_nodes" && i.ids.includes("orphan"))).toBe(true);
  });

  it("skips reachability when start has incoming edge", () => {
    const g = doc({
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "t1", type: "task", position: { x: 0, y: 0 }, data: {} },
        { id: "orphan", type: "task", position: { x: 0, y: 0 }, data: {} },
      ],
      edges: [
        {
          id: "bad",
          source: "t1",
          sourceHandle: "out_default",
          target: "s1",
          targetHandle: "in_default",
          condition: null,
        },
      ],
    });
    const issues = findStructureIssues(g);
    expect(issues.some((i) => i.kind === "unreachable_nodes")).toBe(false);
  });

  it("adds merge_few_inputs when merge has one incoming from non-comment", () => {
    const g = doc({
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "m1", type: "merge", position: { x: 0, y: 0 }, data: {} },
      ],
      edges: [
        {
          id: "e1",
          source: "s1",
          sourceHandle: "out_default",
          target: "m1",
          targetHandle: "in_default",
          condition: null,
        },
      ],
    });
    const issues = findStructureIssues(g);
    expect(
      issues.some(
        (i) => i.kind === "merge_few_inputs" && i.nodeId === "m1" && i.incomingEdges === 1,
      ),
    ).toBe(true);
  });
});
