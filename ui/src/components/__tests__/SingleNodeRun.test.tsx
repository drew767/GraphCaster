// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { GraphCanvasSelection } from "../canvas/graphCanvasSelection";
import type { GraphDocumentJson } from "../../graph/types";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (params) return `${key}:${JSON.stringify(params)}`;
      return key;
    },
  }),
}));

vi.mock("../../run/runSessionStore", () => ({
  useRunSessionOutputs: () => ({}),
  useRunSessionLifecycle: () => ({
    liveRunIds: [],
    pendingRunCount: 0,
    focusedRunId: null,
    activeRunId: null,
    replaySourceLabel: null,
    canClearSettledRunVisual: false,
  }),
  useRunSessionVisual: () => ({
    activeNodeId: null,
    nodeRunOverlay: {},
    nodeRunOverlayRevision: 0,
    highlightedRunEdgeId: null,
    edgeRunOverlayRevision: 0,
  }),
  useRunSessionConsole: () => ({
    consoleLines: [],
    pythonBanner: null,
    lastExitCode: null,
    replaySourceLabel: null,
    focusedRunId: null,
    activeRunId: null,
  }),
  runSessionAppendLine: vi.fn(),
  getStepCacheDirtySnapshot: () => ({ ids: [] }),
}));

vi.mock("../../run/stepCacheDirtyStore", () => ({
  getStepCacheDirtySnapshot: () => ({ ids: [] }),
  markStepCacheDirtyTransitive: vi.fn(),
  useStepCacheDirtyCount: () => 0,
}));

vi.mock("../PromptEditor/upstream_collector", () => ({
  collectUpstreamNodes: (_doc: unknown, _id: string) => [],
}));

vi.mock("../PromptEditor/promptable_fields", () => ({
  isPromptableField: () => false,
}));

const { InspectorPanel } = await import("../InspectorPanel");

function makeDoc(graphId = "graph-1"): GraphDocumentJson {
  return {
    schemaVersion: 1,
    meta: { schemaVersion: 1, graphId, title: "Test" },
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      { id: "start-1", type: "start", position: { x: 0, y: 0 }, data: {} },
      { id: "task-1", type: "task", position: { x: 100, y: 0 }, data: {} },
    ],
    edges: [
      {
        id: "e1",
        source: "start-1",
        sourceHandle: "out_default",
        target: "task-1",
        targetHandle: "in_default",
        condition: null,
      },
    ],
  };
}

function makeTaskSelection(
  id = "task-1",
  raw: Record<string, unknown> = {},
): GraphCanvasSelection {
  return { kind: "node", id, graphNodeType: "task", label: "Task", raw };
}

function renderPanel(props: {
  selection?: GraphCanvasSelection | null;
  onRunThisNodeOnly?: (nodeId: string, ctx: Record<string, unknown>) => void;
  runThisNodeOnlyEnabled?: boolean;
  onApplyNodeData?: (nodeId: string, data: Record<string, unknown>) => void;
}) {
  const noop = () => {};
  return render(
    <InspectorPanel
      selection={props.selection ?? null}
      graphDocument={makeDoc()}
      onApplyGraphDocumentSettings={noop}
      onApplyNodeData={props.onApplyNodeData ?? noop}
      onApplyEdgeCondition={noop}
      workspaceLinked={false}
      runLocked={false}
      onRunThisNodeOnly={props.onRunThisNodeOnly}
      runThisNodeOnlyEnabled={props.runThisNodeOnlyEnabled ?? true}
    />,
  );
}

describe("InspectorPanel — node-level controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not show 'Run this node only' button for start node", () => {
    const startSel: GraphCanvasSelection = {
      kind: "node",
      id: "start-1",
      graphNodeType: "start",
      label: "Start",
      raw: {},
    };
    renderPanel({
      selection: startSel,
      onRunThisNodeOnly: vi.fn(),
      runThisNodeOnlyEnabled: true,
    });
    expect(screen.queryByText("app.inspector.runThisNodeOnly")).toBeNull();
  });

  it("does not show 'Run this node only' button when handler is not provided", () => {
    renderPanel({
      selection: makeTaskSelection(),
      onRunThisNodeOnly: undefined,
    });
    expect(screen.queryByText("app.inspector.runThisNodeOnly")).toBeNull();
  });

  it("'Clear pin' button removes gcPin from node data", () => {
    const applyNodeData = vi.fn();
    const rawWithPin = { gcPin: { enabled: true, payload: { processResult: { out: "x" } } } };
    renderPanel({
      selection: makeTaskSelection("task-1", rawWithPin),
      onApplyNodeData: applyNodeData,
    });
    const clearBtn = screen.getByText("app.inspector.pinClear");
    expect(clearBtn).toBeDefined();
    fireEvent.click(clearBtn);
    expect(applyNodeData).toHaveBeenCalledOnce();
    const [nodeId, data] = applyNodeData.mock.calls[0] as [string, Record<string, unknown>];
    expect(nodeId).toBe("task-1");
    expect(data.gcPin).toBeUndefined();
  });
});
