// Copyright GraphCaster. All Rights Reserved.

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";

import { useCanvasSelection } from "./useCanvasSelection";
import type { GraphDocumentJson } from "../../graph/types";

function doc(extraNodes: GraphDocumentJson["nodes"] = []): GraphDocumentJson {
  return {
    schemaVersion: 1,
    meta: { graphId: "g1" },
    nodes: [
      { id: "start", type: "start", position: { x: 0, y: 0 } },
      ...(extraNodes ?? []),
    ],
    edges: [],
  };
}

describe("useCanvasSelection", () => {
  it("starts with null selection", () => {
    const { result } = renderHook(() => useCanvasSelection({ graphDocument: doc() }));
    expect(result.current.selection).toBeNull();
    expect(result.current.selectionRef.current).toBeNull();
  });

  it("setSelection updates state and selectionRef", () => {
    const { result } = renderHook(() => useCanvasSelection({ graphDocument: doc() }));

    act(() => {
      result.current.setSelection({
        kind: "node",
        id: "start",
        graphNodeType: "start",
        label: "start",
        raw: {},
      });
    });

    expect(result.current.selection?.kind).toBe("node");
    expect(result.current.selectionRef.current?.kind).toBe("node");
  });

  it("clearSelection sets to null", () => {
    const { result } = renderHook(() => useCanvasSelection({ graphDocument: doc() }));
    act(() => {
      result.current.setSelection({
        kind: "node",
        id: "start",
        graphNodeType: "start",
        label: "start",
        raw: {},
      });
    });
    expect(result.current.selection).not.toBeNull();

    act(() => {
      result.current.clearSelection();
    });
    expect(result.current.selection).toBeNull();
  });

  it("drops node selection when its node disappears from the document", () => {
    const initialDoc: GraphDocumentJson = doc([
      { id: "task-1", type: "code", position: { x: 10, y: 10 } },
    ]);
    const { result, rerender } = renderHook(
      ({ d }: { d: GraphDocumentJson }) => useCanvasSelection({ graphDocument: d }),
      { initialProps: { d: initialDoc } },
    );

    act(() => {
      result.current.setSelection({
        kind: "node",
        id: "task-1",
        graphNodeType: "code",
        label: "task-1",
        raw: {},
      });
    });

    expect(result.current.selection?.kind).toBe("node");

    rerender({ d: doc() });
    expect(result.current.selection).toBeNull();
  });
});
