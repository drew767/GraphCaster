// Copyright GraphCaster. All Rights Reserved.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getMaxConcurrentRuns,
  getRunSessionSnapshot,
  runSessionAbortRegisteredRun,
  runSessionApplyParsedRunEventToOverlay,
  runSessionCanStartAnotherLive,
  runSessionEnqueuePending,
  runSessionOnRunProcessExited,
  runSessionRegisterLiveRun,
  runSessionResetForTest,
  LS_MAX_CONCURRENT_RUNS,
} from "./runSessionStore";

describe("runSessionStore multi-run queue", () => {
  afterEach(() => {
    runSessionResetForTest();
    vi.unstubAllGlobals();
  });

  it("respects max concurrent via localStorage", () => {
    runSessionResetForTest();
    const stub = {
      getItem: vi.fn((k: string) => (k === LS_MAX_CONCURRENT_RUNS ? "3" : null)),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    vi.stubGlobal("localStorage", stub);
    expect(getMaxConcurrentRuns()).toBe(3);
  });

  it("FIFO starts next pending when a live run exits", () => {
    runSessionResetForTest();
    const stub = {
      getItem: vi.fn((k: string) => (k === LS_MAX_CONCURRENT_RUNS ? "1" : null)),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    vi.stubGlobal("localStorage", stub);
    runSessionRegisterLiveRun("a");
    expect(runSessionCanStartAnotherLive()).toBe(false);
    runSessionEnqueuePending({
      documentJson: "{}",
      runId: "b",
    });
    expect(getRunSessionSnapshot().pendingRunCount).toBe(1);
    const next = runSessionOnRunProcessExited("a", 0);
    expect(next?.runId).toBe("b");
    expect(getRunSessionSnapshot().liveRunIds).toEqual([]);
    expect(getRunSessionSnapshot().pendingRunCount).toBe(0);
  });

  it("abort removes live run and returns next pending when a slot opens", () => {
    runSessionResetForTest();
    const stub = {
      getItem: vi.fn((k: string) => (k === LS_MAX_CONCURRENT_RUNS ? "2" : null)),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    vi.stubGlobal("localStorage", stub);
    runSessionRegisterLiveRun("x");
    runSessionRegisterLiveRun("y");
    runSessionEnqueuePending({ documentJson: "{}", runId: "z" });
    const next = runSessionAbortRegisteredRun("x");
    expect(next?.runId).toBe("z");
    expect(getRunSessionSnapshot().liveRunIds).toEqual(["y"]);
    expect(getRunSessionSnapshot().pendingRunCount).toBe(0);
  });

  it("bumps nodeRunOverlayRevision when registering focus and when overlay mutates", () => {
    runSessionResetForTest();
    expect(getRunSessionSnapshot().nodeRunOverlayRevision).toBe(0);
    const stub = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    vi.stubGlobal("localStorage", stub);
    runSessionRegisterLiveRun("r1");
    const afterReg = getRunSessionSnapshot().nodeRunOverlayRevision;
    expect(afterReg).toBeGreaterThan(0);
    runSessionApplyParsedRunEventToOverlay("r1", {
      type: "node_enter",
      nodeId: "n1",
      graphId: "g",
    });
    expect(getRunSessionSnapshot().nodeRunOverlayRevision).toBeGreaterThan(afterReg);
  });
});
