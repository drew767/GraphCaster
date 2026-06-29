// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

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

vi.mock("../../../run/runSessionStore", () => ({
  useRunSessionOutputs: () => ({}),
  runSessionAppendLine: vi.fn(),
}));

vi.mock("../../../run/stepCacheDirtyStore", () => ({
  getStepCacheDirtySnapshot: () => ({ ids: [] }),
  markStepCacheDirtyTransitive: vi.fn(),
  useStepCacheDirtyCount: () => 0,
}));

const { NodeInspector } = await import("../NodeInspector");

function makeDoc(): GraphDocumentJson {
  return {
    schemaVersion: 1,
    meta: { schemaVersion: 1, graphId: "g-1", title: "Test" },
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [{ id: "task-1", type: "task", position: { x: 0, y: 0 }, data: {} }],
    edges: [],
  };
}

function makeNodeSelection(raw: Record<string, unknown> = {}): Extract<
  GraphCanvasSelection,
  { kind: "node" }
> {
  return { kind: "node", id: "task-1", graphNodeType: "task", label: "Task", raw };
}

describe("NodeInspector smoke", () => {
  it("renders node id, type, label and the JSON form for a basic task selection", () => {
    render(
      <NodeInspector
        selection={makeNodeSelection()}
        graphDocument={makeDoc()}
        expressionNodeIds={["task-1"]}
        expressionEditorMonaco={false}
        setExpressionEditorMonaco={() => {}}
        runLocked={false}
        workspaceLinked={false}
        onApplyNodeData={() => {}}
        runUntilThisNodeEnabled={false}
      />,
    );
    expect(screen.getByText("app.inspector.nodeId")).toBeDefined();
    expect(screen.getByText("task-1")).toBeDefined();
    expect(screen.getByText("app.inspector.dataJson")).toBeDefined();
  });
});
