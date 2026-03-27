// Copyright GraphCaster. All Rights Reserved.

import { beforeEach, describe, expect, it } from "vitest";

import type { GraphDocumentJson } from "../graph/types";
import {
  markStepCacheDirtyWithNestedBubble,
  type NestedGraphRefFrame,
} from "./nestedStepCacheDirtyBubble";
import { clearStepCacheDirtyIds, getStepCacheDirtySnapshot } from "./stepCacheDirtyStore";

function docWithLinearCachedTask(taskId: string): GraphDocumentJson {
  return {
    schemaVersion: 1,
    meta: { schemaVersion: 1, graphId: "11111111-1111-4111-8111-111111111111", title: "t" },
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      { id: "s", type: "start", position: { x: 0, y: 0 }, data: {} },
      {
        id: taskId,
        type: "task",
        position: { x: 0, y: 0 },
        data: { stepCache: true },
      },
      { id: "x", type: "exit", position: { x: 0, y: 0 }, data: {} },
    ],
    edges: [
      {
        id: "e1",
        source: "s",
        sourceHandle: "out_default",
        target: taskId,
        targetHandle: "in_default",
        condition: null,
      },
      {
        id: "e2",
        source: taskId,
        sourceHandle: "out_default",
        target: "x",
        targetHandle: "in_default",
        condition: null,
      },
    ],
  };
}

describe("nestedStepCacheDirtyBubble", () => {
  beforeEach(() => {
    clearStepCacheDirtyIds();
  });

  it("marks local seeds then each parent transitive closure from stack order", async () => {
    const child = docWithLinearCachedTask("tChild");
    const parentB = docWithLinearCachedTask("refB");
    const parentA = docWithLinearCachedTask("refA");
    const read = async (name: string): Promise<GraphDocumentJson | null> => {
      if (name === "b.json") {
        return parentB;
      }
      if (name === "a.json") {
        return parentA;
      }
      return null;
    };
    const stack: NestedGraphRefFrame[] = [
      { parentWorkspaceFileName: "a.json", graphRefNodeId: "refA" },
      { parentWorkspaceFileName: "b.json", graphRefNodeId: "refB" },
    ];
    await markStepCacheDirtyWithNestedBubble(child, ["tChild"], stack, read);
    const ids = new Set(getStepCacheDirtySnapshot().ids);
    expect(ids.has("tChild")).toBe(true);
    expect(ids.has("refB")).toBe(true);
    expect(ids.has("refA")).toBe(true);
  });

  it("skips missing parent reads", async () => {
    const child = docWithLinearCachedTask("tOnly");
    const read = async (): Promise<GraphDocumentJson | null> => null;
    await markStepCacheDirtyWithNestedBubble(
      child,
      ["tOnly"],
      [{ parentWorkspaceFileName: "missing.json", graphRefNodeId: "r" }],
      read,
    );
    expect(getStepCacheDirtySnapshot().ids).toEqual(["tOnly"]);
  });
});
