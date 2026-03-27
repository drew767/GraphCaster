// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import { GRAPH_NODE_TYPE_TASK } from "../graph/nodeKinds";
import {
  addStepCacheDirtyId,
  addStepCacheDirtyIds,
  clearStepCacheDirtyIds,
  consumeStepCacheDirtyCsvForRun,
  getStepCacheDirtySnapshot,
  markStepCacheDirtyTransitive,
} from "./stepCacheDirtyStore";

describe("stepCacheDirtyStore", () => {
  it("dedupes and orders ids stably", () => {
    clearStepCacheDirtyIds();
    addStepCacheDirtyId("b");
    addStepCacheDirtyId("a");
    addStepCacheDirtyId("b");
    expect(getStepCacheDirtySnapshot().ids).toEqual(["b", "a"]);
  });

  it("consume returns csv and clears", () => {
    clearStepCacheDirtyIds();
    addStepCacheDirtyId("x");
    addStepCacheDirtyId("y");
    expect(consumeStepCacheDirtyCsvForRun()).toBe("x,y");
    expect(getStepCacheDirtySnapshot().ids).toEqual([]);
  });

  it("addStepCacheDirtyIds appends unique ids", () => {
    clearStepCacheDirtyIds();
    addStepCacheDirtyId("a");
    addStepCacheDirtyIds(["b", "a", "c"]);
    expect(getStepCacheDirtySnapshot().ids).toEqual(["a", "b", "c"]);
  });

  it("markStepCacheDirtyTransitive adds filtered transitive closure", () => {
    clearStepCacheDirtyIds();
    markStepCacheDirtyTransitive(
      {
        nodes: [
          { id: "a", type: GRAPH_NODE_TYPE_TASK, data: { stepCache: true } },
          { id: "b", type: GRAPH_NODE_TYPE_TASK, data: { stepCache: true } },
        ],
        edges: [{ id: "e1", source: "a", target: "b" }],
      },
      ["a"],
    );
    expect(getStepCacheDirtySnapshot().ids).toEqual(["a", "b"]);
  });
});
