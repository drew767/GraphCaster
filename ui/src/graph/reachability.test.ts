// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import { findUnreachableWorkflowNodeIds } from "./reachability";
import type { GraphDocumentJson } from "./types";

function doc(partial: Omit<GraphDocumentJson, "schemaVersion" | "meta" | "viewport"> & Partial<Pick<GraphDocumentJson, "viewport">>): GraphDocumentJson {
  return {
    schemaVersion: 1,
    meta: { schemaVersion: 1, graphId: "ffffffff-ffff-4fff-8fff-ffffffffffff", title: "t" },
    viewport: partial.viewport ?? { x: 0, y: 0, zoom: 1 },
    ...partial,
  };
}

describe("findUnreachableWorkflowNodeIds", () => {
  it("flags orphan task not connected from start", () => {
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
    expect(findUnreachableWorkflowNodeIds(g, "s1")).toEqual(["orphan"]);
  });

  it("empty when linear start-task-exit", () => {
    const g = doc({
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "t1", type: "task", position: { x: 0, y: 0 }, data: {} },
        { id: "x1", type: "exit", position: { x: 0, y: 0 }, data: {} },
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
        {
          id: "e2",
          source: "t1",
          sourceHandle: "out_default",
          target: "x1",
          targetHandle: "in_default",
          condition: null,
        },
      ],
    });
    expect(findUnreachableWorkflowNodeIds(g, "s1")).toEqual([]);
  });

  it("excludes comment nodes from unreachable list", () => {
    const g = doc({
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "c1", type: "comment", position: { x: 0, y: 0 }, data: {} },
      ],
      edges: [],
    });
    expect(findUnreachableWorkflowNodeIds(g, "s1")).toEqual([]);
  });

  it("follows out_error edge for static reachability", () => {
    const g = doc({
      nodes: [
        { id: "s1", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "t1", type: "task", position: { x: 0, y: 0 }, data: { command: "echo" } },
        { id: "e_recovery", type: "exit", position: { x: 0, y: 0 }, data: {} },
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
        {
          id: "e2",
          source: "t1",
          sourceHandle: "out_error",
          target: "e_recovery",
          targetHandle: "in_default",
          condition: null,
        },
      ],
    });
    expect(findUnreachableWorkflowNodeIds(g, "s1")).toEqual(["orphan"]);
  });
});
