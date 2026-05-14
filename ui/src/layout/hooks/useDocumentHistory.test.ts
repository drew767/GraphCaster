// Copyright GraphCaster. All Rights Reserved.

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useDocumentHistory } from "./useDocumentHistory";
import type { GraphDocumentJson } from "../../graph/types";

function createTestDoc(id: string): GraphDocumentJson {
  return {
    schemaVersion: 1,
    meta: { graphId: id },
    nodes: [{ id: "start", type: "start", position: { x: 0, y: 0 } }],
    edges: [],
  };
}

describe("useDocumentHistory", () => {
  it("starts with empty history", () => {
    const { result } = renderHook(() => useDocumentHistory());

    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("allows undo after snapshot", () => {
    const doc1 = createTestDoc("test-1");
    const doc2 = createTestDoc("test-2");

    const { result } = renderHook(() => useDocumentHistory());

    act(() => {
      result.current.snapshotDocument(doc1);
    });

    expect(result.current.canUndo).toBe(true);

    let undone: GraphDocumentJson | null = null;
    act(() => {
      undone = result.current.tryUndo(doc2);
    });

    expect(undone).not.toBeNull();
    expect(undone?.meta?.graphId).toBe("test-1");
    expect(result.current.canRedo).toBe(true);
  });

  it("allows redo after undo", () => {
    const doc1 = createTestDoc("test-1");
    const doc2 = createTestDoc("test-2");

    const { result } = renderHook(() => useDocumentHistory());

    act(() => {
      result.current.snapshotDocument(doc1);
    });

    let undone: GraphDocumentJson | null = null;
    act(() => {
      undone = result.current.tryUndo(doc2);
    });

    expect(undone).not.toBeNull();

    let redone: GraphDocumentJson | null = null;
    act(() => {
      redone = result.current.tryRedo(undone!);
    });

    expect(redone).not.toBeNull();
    expect(redone?.meta?.graphId).toBe("test-2");
  });

  it("clears history", () => {
    const doc1 = createTestDoc("test-1");

    const { result } = renderHook(() => useDocumentHistory());

    act(() => {
      result.current.snapshotDocument(doc1);
    });

    expect(result.current.canUndo).toBe(true);

    act(() => {
      result.current.clearHistory();
    });

    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("respects historyCap option", () => {
    const { result } = renderHook(() => useDocumentHistory({ historyCap: 3 }));

    act(() => {
      result.current.snapshotDocument(createTestDoc("doc-1"));
      result.current.snapshotDocument(createTestDoc("doc-2"));
      result.current.snapshotDocument(createTestDoc("doc-3"));
      result.current.snapshotDocument(createTestDoc("doc-4"));
    });

    // Should only keep 3 items in history
    expect(result.current.historyRef.current.past.length).toBe(3);
  });

  it("bumps history tick on operations", () => {
    const { result } = renderHook(() => useDocumentHistory());

    const initialTick = result.current.historyTick;

    act(() => {
      result.current.snapshotDocument(createTestDoc("doc-1"));
    });

    expect(result.current.historyTick).toBeGreaterThan(initialTick);

    const tickAfterSnapshot = result.current.historyTick;

    act(() => {
      result.current.bumpHistoryTick();
    });

    expect(result.current.historyTick).toBeGreaterThan(tickAfterSnapshot);
  });
});
