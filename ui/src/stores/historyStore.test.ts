// Copyright GraphCaster. All Rights Reserved.

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useHistoryStore } from "./historyStore";

describe("historyStore", () => {
  afterEach(() => {
    useHistoryStore.getState().reset();
  });

  it("starts with empty state", () => {
    const { result } = renderHook(() => useHistoryStore());

    expect(result.current.runs).toEqual([]);
    expect(result.current.selectedRunId).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it("sets runs", () => {
    const { result } = renderHook(() => useHistoryStore());

    act(() => {
      result.current.setRuns([
        {
          runId: "run-1",
          graphId: "g",
          graphName: "Test",
          status: "completed",
          startedAt: "2026-03-30T10:00:00Z",
          eventCount: 0,
          trigger: "manual",
        },
        {
          runId: "run-2",
          graphId: "g",
          graphName: "Test",
          status: "failed",
          startedAt: "2026-03-30T10:00:00Z",
          eventCount: 0,
          trigger: "manual",
        },
      ]);
    });

    expect(result.current.runs).toHaveLength(2);
  });

  it("selects run", () => {
    const { result } = renderHook(() => useHistoryStore());

    act(() => {
      result.current.setRuns([
        {
          runId: "run-1",
          graphId: "g",
          graphName: "Test",
          status: "completed",
          startedAt: "2026-03-30T10:00:00Z",
          eventCount: 0,
          trigger: "manual",
        },
      ]);
      result.current.selectRun("run-1");
    });

    expect(result.current.selectedRunId).toBe("run-1");
    expect(result.current.selectedRun?.runId).toBe("run-1");
  });

  it("sets filters", () => {
    const { result } = renderHook(() => useHistoryStore());

    act(() => {
      result.current.setFilter({ status: "failed" });
    });

    expect(result.current.filter.status).toBe("failed");
  });

  it("sets replay state", () => {
    const { result } = renderHook(() => useHistoryStore());

    act(() => {
      result.current.setReplayState({
        currentIndex: 5,
        totalEvents: 10,
        nodeStates: { A: "completed" },
        nodeOutputs: {},
        isPlaying: false,
      });
    });

    expect(result.current.replayState?.currentIndex).toBe(5);
  });
});
