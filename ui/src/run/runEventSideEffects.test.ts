// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, vi } from "vitest";

import * as store from "./runSessionStore";
import { applyRunnerNdjsonSideEffects } from "./runEventSideEffects";

describe("applyRunnerNdjsonSideEffects", () => {
  it("updates active node on node_enter", () => {
    const spy = vi.spyOn(store, "runSessionSetActiveNodeId");
    applyRunnerNdjsonSideEffects('{"type":"node_enter","nodeId":"n1"}');
    expect(spy).toHaveBeenCalledWith("n1");
    spy.mockRestore();
  });
});
