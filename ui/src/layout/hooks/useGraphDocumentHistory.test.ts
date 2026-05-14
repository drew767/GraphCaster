// Copyright GraphCaster. All Rights Reserved.

import { renderHook, act } from "@testing-library/react";
import { useRef } from "react";
import { describe, it, expect, vi } from "vitest";

import { useGraphDocumentHistory } from "./useGraphDocumentHistory";
import type { GraphCanvasHandle } from "../../components/GraphCanvas";
import type { GraphDocumentJson } from "../../graph/types";

function doc(id: string): GraphDocumentJson {
  return {
    schemaVersion: 1,
    meta: { graphId: id },
    nodes: [{ id: "start", type: "start", position: { x: 0, y: 0 } }],
    edges: [],
  };
}

function setupRefs(initial: GraphDocumentJson, canvasReturns: GraphDocumentJson | null) {
  const canvasRef = {
    current:
      canvasReturns == null
        ? null
        : ({ exportDocument: () => canvasReturns } as unknown as GraphCanvasHandle),
  };
  const graphDocumentRef = { current: initial };
  return { canvasRef, graphDocumentRef };
}

describe("useGraphDocumentHistory", () => {
  it("renders with no history and exposes initial state", () => {
    const { canvasRef, graphDocumentRef } = setupRefs(doc("a"), null);
    const { result } = renderHook(() =>
      useGraphDocumentHistory({
        canvasRef,
        graphDocumentRef,
        setGraphDocument: vi.fn(),
        setDanglingEdgesExportIds: vi.fn(),
        bumpLayoutDirtyEpoch: vi.fn(),
        isRunBlocking: () => false,
      }),
    );

    expect(result.current.historyRef.current.past).toEqual([]);
    expect(result.current.historyRef.current.future).toEqual([]);
    expect(result.current.historyTick).toBe(0);
  });

  it("commitHistorySnapshot snapshots current document and bumps tick", () => {
    const current = doc("a");
    const { canvasRef, graphDocumentRef } = setupRefs(current, current);
    const { result } = renderHook(() =>
      useGraphDocumentHistory({
        canvasRef,
        graphDocumentRef,
        setGraphDocument: vi.fn(),
        setDanglingEdgesExportIds: vi.fn(),
        bumpLayoutDirtyEpoch: vi.fn(),
        isRunBlocking: () => false,
      }),
    );

    const tickBefore = result.current.historyTick;
    act(() => {
      result.current.commitHistorySnapshot();
    });
    expect(result.current.historyRef.current.past.length).toBe(1);
    expect(result.current.historyTick).toBeGreaterThan(tickBefore);
  });

  it("skips snapshot when run is blocking", () => {
    const current = doc("a");
    const { canvasRef, graphDocumentRef } = setupRefs(current, current);
    const { result } = renderHook(() =>
      useGraphDocumentHistory({
        canvasRef,
        graphDocumentRef,
        setGraphDocument: vi.fn(),
        setDanglingEdgesExportIds: vi.fn(),
        bumpLayoutDirtyEpoch: vi.fn(),
        isRunBlocking: () => true,
      }),
    );
    act(() => {
      result.current.commitHistorySnapshot();
    });
    expect(result.current.historyRef.current.past.length).toBe(0);
  });

  it("performUndo applies side-effects and replaces document", () => {
    const setGraphDocument = vi.fn();
    const setDanglingEdgesExportIds = vi.fn();
    const bumpLayoutDirtyEpoch = vi.fn();

    function harness() {
      const canvasRef = useRef<GraphCanvasHandle | null>(null);
      const graphDocumentRef = useRef<GraphDocumentJson>(doc("a"));
      return useGraphDocumentHistory({
        canvasRef,
        graphDocumentRef,
        setGraphDocument,
        setDanglingEdgesExportIds,
        bumpLayoutDirtyEpoch,
        isRunBlocking: () => false,
      });
    }

    const { result } = renderHook(harness);

    act(() => {
      result.current.commitHistorySnapshot();
    });
    expect(result.current.historyRef.current.past.length).toBe(1);

    act(() => {
      result.current.performUndo();
    });
    expect(setGraphDocument).toHaveBeenCalled();
    expect(setDanglingEdgesExportIds).toHaveBeenCalledWith(null);
    expect(bumpLayoutDirtyEpoch).toHaveBeenCalled();
  });

  it("resetHistory clears past and future", () => {
    const current = doc("a");
    const { canvasRef, graphDocumentRef } = setupRefs(current, current);
    const { result } = renderHook(() =>
      useGraphDocumentHistory({
        canvasRef,
        graphDocumentRef,
        setGraphDocument: vi.fn(),
        setDanglingEdgesExportIds: vi.fn(),
        bumpLayoutDirtyEpoch: vi.fn(),
        isRunBlocking: () => false,
      }),
    );

    act(() => {
      result.current.commitHistorySnapshot();
    });
    expect(result.current.historyRef.current.past.length).toBe(1);

    act(() => {
      result.current.resetHistory();
    });
    expect(result.current.historyRef.current.past).toEqual([]);
    expect(result.current.historyRef.current.future).toEqual([]);
  });
});
