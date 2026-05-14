// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import type { GraphCanvasSelection } from "../../canvas/graphCanvasSelection";
import type { GraphDocumentJson } from "../../../graph/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (params) return `${key}:${JSON.stringify(params)}`;
      return key;
    },
  }),
}));

const { EdgeInspector } = await import("../EdgeInspector");

function makeDoc(): GraphDocumentJson {
  return {
    schemaVersion: 1,
    meta: { schemaVersion: 1, graphId: "g-1", title: "Test" },
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      { id: "n-src", type: "task", position: { x: 0, y: 0 }, data: {} },
      { id: "n-tgt", type: "task", position: { x: 100, y: 0 }, data: {} },
    ],
    edges: [],
  };
}

function makeEdgeSelection(): Extract<GraphCanvasSelection, { kind: "edge" }> {
  return {
    kind: "edge",
    id: "e-1",
    source: "n-src",
    target: "n-tgt",
    condition: null,
    routeDescription: "",
  };
}

describe("EdgeInspector smoke", () => {
  it("renders edge id/source/target and condition input", () => {
    render(
      <EdgeInspector
        selection={makeEdgeSelection()}
        graphDocument={makeDoc()}
        expressionNodeIds={["n-src", "n-tgt"]}
        expressionEditorMonaco={false}
        setExpressionEditorMonaco={() => {}}
        runLocked={false}
        onApplyEdgeCondition={() => {}}
      />,
    );
    expect(screen.getByText("app.inspector.edgeId")).toBeDefined();
    expect(screen.getByText("e-1")).toBeDefined();
    expect(screen.getByText("n-src")).toBeDefined();
    expect(screen.getByText("n-tgt")).toBeDefined();
    expect(screen.getByText("app.inspector.edgeCondition")).toBeDefined();
  });

  it("invokes onApplyEdgeCondition on submit with trimmed text or null", () => {
    const handler = vi.fn();
    render(
      <EdgeInspector
        selection={makeEdgeSelection()}
        graphDocument={makeDoc()}
        expressionNodeIds={["n-src", "n-tgt"]}
        expressionEditorMonaco={false}
        setExpressionEditorMonaco={() => {}}
        runLocked={false}
        onApplyEdgeCondition={handler}
      />,
    );
    fireEvent.click(screen.getByText("app.inspector.applyEdgeCondition"));
    expect(handler).toHaveBeenCalledOnce();
    const [edgeId, cond] = handler.mock.calls[0] as [string, string | null];
    expect(edgeId).toBe("e-1");
    expect(cond).toBeNull();
  });
});
