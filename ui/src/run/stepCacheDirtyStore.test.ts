// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import {
  addStepCacheDirtyId,
  clearStepCacheDirtyIds,
  consumeStepCacheDirtyCsvForRun,
  getStepCacheDirtySnapshot,
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
});
