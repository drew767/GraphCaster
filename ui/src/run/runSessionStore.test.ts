// Copyright GraphCaster. All Rights Reserved.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getMaxConcurrentRuns,
  getRunSessionSnapshot,
  runSessionAbortRegisteredRun,
  runSessionApplyParsedRunEventToOverlay,
  runSessionCanStartAnotherLive,
  runSessionClearSettledVisualForCurrentGraph,
  runSessionEnqueuePending,
  runSessionNoteRootGraphForRun,
  runSessionOnRunProcessExited,
  runSessionRegisterLiveRun,
  runSessionResetForTest,
  runSessionSetCurrentRootGraphId,
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

  it("bumps edgeRunOverlayRevision and exposes highlightedRunEdgeId on edge_traverse", () => {
    runSessionResetForTest();
    const stub = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    vi.stubGlobal("localStorage", stub);
    runSessionRegisterLiveRun("r1");
    const rev0 = getRunSessionSnapshot().edgeRunOverlayRevision;
    expect(getRunSessionSnapshot().highlightedRunEdgeId).toBeNull();
    runSessionApplyParsedRunEventToOverlay("r1", {
      type: "edge_traverse",
      edgeId: "e-1",
      graphId: "g",
    });
    expect(getRunSessionSnapshot().highlightedRunEdgeId).toBe("e-1");
    expect(getRunSessionSnapshot().edgeRunOverlayRevision).toBeGreaterThan(rev0);
  });
});

describe("runSessionStore settled post-run canvas overlay", () => {
  afterEach(() => {
    runSessionResetForTest();
    vi.unstubAllGlobals();
  });

  it("keeps node phases on canvas after run exits for same rootGraphId", () => {
    runSessionSetCurrentRootGraphId("g-root");
    runSessionRegisterLiveRun("run-1");
    runSessionNoteRootGraphForRun("run-1", "g-root");
    runSessionApplyParsedRunEventToOverlay("run-1", {
      type: "node_enter",
      nodeId: "n1",
      graphId: "g-root",
    });
    runSessionApplyParsedRunEventToOverlay("run-1", {
      type: "node_exit",
      nodeId: "n1",
      graphId: "g-root",
    });
    runSessionApplyParsedRunEventToOverlay("run-1", {
      type: "run_finished",
      status: "success",
      rootGraphId: "g-root",
      runId: "run-1",
      finishedAt: "2026-01-01T00:00:00Z",
    });
    runSessionOnRunProcessExited("run-1", 0);
    const snap = getRunSessionSnapshot();
    expect(snap.nodeRunOverlayByNodeId.n1?.phase).toBe("success");
    expect(snap.canClearSettledRunVisual).toBe(true);
  });

  it("keeps last traversed edge on settle after run_finished cleared live edge highlight", () => {
    runSessionSetCurrentRootGraphId("g1");
    runSessionRegisterLiveRun("r1");
    runSessionNoteRootGraphForRun("r1", "g1");
    runSessionApplyParsedRunEventToOverlay("r1", { type: "edge_traverse", edgeId: "e1", graphId: "g1" });
    expect(getRunSessionSnapshot().highlightedRunEdgeId).toBe("e1");
    runSessionApplyParsedRunEventToOverlay("r1", {
      type: "run_finished",
      status: "success",
      rootGraphId: "g1",
      runId: "r1",
      finishedAt: "2026-01-01T00:00:00Z",
    });
    expect(getRunSessionSnapshot().highlightedRunEdgeId).toBeNull();
    runSessionOnRunProcessExited("r1", 0);
    expect(getRunSessionSnapshot().highlightedRunEdgeId).toBe("e1");
  });

  it("clears settled for current graph when registering a new live run", () => {
    runSessionSetCurrentRootGraphId("g-root");
    runSessionRegisterLiveRun("run-1");
    runSessionNoteRootGraphForRun("run-1", "g-root");
    runSessionApplyParsedRunEventToOverlay("run-1", {
      type: "node_exit",
      nodeId: "n1",
      graphId: "g-root",
    });
    runSessionOnRunProcessExited("run-1", 0);
    expect(getRunSessionSnapshot().nodeRunOverlayByNodeId.n1?.phase).toBe("success");

    runSessionRegisterLiveRun("run-2");
    expect(getRunSessionSnapshot().nodeRunOverlayByNodeId).toEqual({});
  });

  it("runSessionClearSettledVisualForCurrentGraph removes sticky overlay", () => {
    runSessionSetCurrentRootGraphId("g-root");
    runSessionRegisterLiveRun("run-1");
    runSessionNoteRootGraphForRun("run-1", "g-root");
    runSessionApplyParsedRunEventToOverlay("run-1", {
      type: "node_exit",
      nodeId: "n1",
      graphId: "g-root",
    });
    runSessionOnRunProcessExited("run-1", 0);
    expect(getRunSessionSnapshot().nodeRunOverlayByNodeId.n1?.phase).toBe("success");
    runSessionClearSettledVisualForCurrentGraph();
    expect(getRunSessionSnapshot().nodeRunOverlayByNodeId).toEqual({});
    expect(getRunSessionSnapshot().canClearSettledRunVisual).toBe(false);
  });

  it("shows the settled overlay for the open graph only when switching currentRootGraphId", () => {
    runSessionSetCurrentRootGraphId("g-a");
    runSessionRegisterLiveRun("run-a");
    runSessionNoteRootGraphForRun("run-a", "g-a");
    runSessionApplyParsedRunEventToOverlay("run-a", {
      type: "node_exit",
      nodeId: "n1",
      graphId: "g-a",
    });
    runSessionOnRunProcessExited("run-a", 0);
    expect(getRunSessionSnapshot().nodeRunOverlayByNodeId.n1?.phase).toBe("success");
    expect(getRunSessionSnapshot().nodeRunOverlayByNodeId.n2).toBeUndefined();

    runSessionSetCurrentRootGraphId("g-b");
    runSessionRegisterLiveRun("run-b");
    runSessionNoteRootGraphForRun("run-b", "g-b");
    runSessionApplyParsedRunEventToOverlay("run-b", {
      type: "node_exit",
      nodeId: "n2",
      graphId: "g-b",
    });
    runSessionOnRunProcessExited("run-b", 0);

    expect(getRunSessionSnapshot().nodeRunOverlayByNodeId.n1).toBeUndefined();
    expect(getRunSessionSnapshot().nodeRunOverlayByNodeId.n2?.phase).toBe("success");

    runSessionSetCurrentRootGraphId("g-a");
    expect(getRunSessionSnapshot().nodeRunOverlayByNodeId.n1?.phase).toBe("success");
    expect(getRunSessionSnapshot().nodeRunOverlayByNodeId.n2).toBeUndefined();

    runSessionSetCurrentRootGraphId("g-b");
    expect(getRunSessionSnapshot().nodeRunOverlayByNodeId.n2?.phase).toBe("success");
  });
});
