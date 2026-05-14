// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  runSingleNode,
  peekSingleStepQueue,
  drainSingleStepQueue,
  subscribeSingleStep,
} from "./runStore";

describe("runStore.runSingleNode", () => {
  beforeEach(() => {
    drainSingleStepQueue();
  });

  it("enqueues a single-step request and notifies subscribers", () => {
    const listener = vi.fn();
    const unsub = subscribeSingleStep(listener);

    const req = runSingleNode("node-42");

    expect(req.nodeId).toBe("node-42");
    expect(req.requestedAt).toBeTypeOf("number");
    expect(peekSingleStepQueue()).toHaveLength(1);
    expect(listener).toHaveBeenCalledWith(req);
    unsub();
  });

  it("drainSingleStepQueue empties the queue and returns prior entries", () => {
    runSingleNode("a");
    runSingleNode("b");
    expect(peekSingleStepQueue()).toHaveLength(2);

    const drained = drainSingleStepQueue();
    expect(drained.map((r) => r.nodeId)).toEqual(["a", "b"]);
    expect(peekSingleStepQueue()).toHaveLength(0);
  });

  it("stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    const unsub = subscribeSingleStep(listener);
    unsub();
    runSingleNode("x");
    expect(listener).not.toHaveBeenCalled();
  });
});
