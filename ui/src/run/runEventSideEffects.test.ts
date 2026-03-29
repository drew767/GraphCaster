// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, vi } from "vitest";

import * as store from "./runSessionStore";
import { applyRunnerNdjsonSideEffects } from "./runEventSideEffects";

describe("applyRunnerNdjsonSideEffects", () => {
  it("updates active node on node_enter for focused live run", () => {
    store.runSessionResetForTest();
    store.runSessionRegisterLiveRun("run-a");
    const spy = vi.spyOn(store, "runSessionSetActiveNodeIdForRun");
    applyRunnerNdjsonSideEffects('{"type":"node_enter","nodeId":"n1"}');
    expect(spy).toHaveBeenCalledWith("run-a", "n1");
    spy.mockRestore();
  });

  it("stores node_outputs_snapshot for a non-focused runId", () => {
    store.runSessionResetForTest();
    store.runSessionRegisterLiveRun("run-a");
    store.runSessionRegisterLiveRun("run-b");
    const spy = vi.spyOn(store, "runSessionSetNodeOutputSnapshotForRun");
    applyRunnerNdjsonSideEffects(
      '{"type":"node_outputs_snapshot","nodeId":"x","snapshot":{"k":1}}',
      "run-a",
    );
    expect(spy).toHaveBeenCalledWith("run-a", "x", { k: 1 });
    spy.mockRestore();
  });

  it("updates node run overlay from NDJSON side effects", () => {
    store.runSessionResetForTest();
    store.runSessionRegisterLiveRun("run-a");
    applyRunnerNdjsonSideEffects(
      '{"type":"node_enter","nodeId":"n1","nodeType":"task","graphId":"g"}',
    );
    expect(store.getRunSessionSnapshot().nodeRunOverlayByNodeId.n1?.phase).toBe("running");
    applyRunnerNdjsonSideEffects(
      '{"type":"node_exit","nodeId":"n1","nodeType":"task","graphId":"g"}',
    );
    expect(store.getRunSessionSnapshot().nodeRunOverlayByNodeId.n1?.phase).toBe("success");
  });

  it("records rootGraphId from run_started so process exit can settle overlay", () => {
    store.runSessionResetForTest();
    store.runSessionSetCurrentRootGraphId("g1");
    store.runSessionRegisterLiveRun("r1");
    applyRunnerNdjsonSideEffects(
      JSON.stringify({
        type: "run_started",
        runId: "r1",
        rootGraphId: "g1",
        startedAt: "2026-01-01T00:00:00Z",
        mode: "manual",
      }),
    );
    applyRunnerNdjsonSideEffects('{"type":"node_enter","nodeId":"n1"}');
    applyRunnerNdjsonSideEffects('{"type":"node_exit","nodeId":"n1"}');
    applyRunnerNdjsonSideEffects(
      JSON.stringify({
        type: "run_finished",
        runId: "r1",
        rootGraphId: "g1",
        status: "success",
        finishedAt: "2026-01-01T00:00:01Z",
      }),
    );
    store.runSessionOnRunProcessExited("r1", 0);
    expect(store.getRunSessionSnapshot().nodeRunOverlayByNodeId.n1?.phase).toBe("success");
  });
});
