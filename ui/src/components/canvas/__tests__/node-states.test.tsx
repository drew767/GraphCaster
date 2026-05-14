// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import type { NodeProps } from "@xyflow/react";
import type { GcNodeData } from "../../../graph/toReactFlow";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    Handle: ({ type, position, id }: { type: string; position: string; id?: string }) => (
      <div data-testid={`handle-${type}-${id ?? position}`} />
    ),
    Position: { Left: "left", Right: "right" },
  };
});

vi.mock("../../../graph/useGcEffectiveNodeTier", () => ({
  useGcEffectiveNodeTier: () => "full",
}));

vi.mock("../../GcConnectionDragContext", () => ({
  useGcConnectionDrag: () => null,
  GcConnectionDragContext: {
    Provider: ({ children }: { children: React.ReactNode }) => children,
  },
}));

vi.mock("../../GcFlowTargetHandle", () => ({
  GcFlowTargetHandle: () => <div data-testid="target-handle" />,
}));

vi.mock("../../../graph/nodes/NodeHoverToolbar", () => ({
  NodeHoverToolbar: () => null,
}));

vi.mock("../../ndv/useNdvStore", () => ({
  useNdvStore: (selector: (s: { openNdv: () => void }) => unknown) =>
    selector({ openNdv: () => {} }),
}));

function makeProps(data: Partial<GcNodeData>, selected = false): NodeProps {
  return {
    id: "test-node",
    data: {
      graphNodeType: "task",
      label: "Test",
      raw: {},
      ...data,
    } as GcNodeData,
    selected,
    dragging: false,
    isConnectable: true,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    zIndex: 1,
    type: "gcNode",
    width: 160,
    height: 40,
    sourcePosition: undefined,
    targetPosition: undefined,
  } as unknown as NodeProps;
}

async function importGcFlowNode() {
  const mod = await import("../../nodes/GcFlowNode");
  return mod.GcFlowNode;
}

describe("GcFlowNode visual states", () => {
  it("muted node has gc-flow-node--muted class", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(<GcFlowNode {...makeProps({ gcMuted: true })} />);
    const node = container.querySelector(".gc-flow-node");
    expect(node?.classList.contains("gc-flow-node--muted")).toBe(true);
  });

  it("bypassed node has gc-flow-node--bypassed class and bypass badge", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(<GcFlowNode {...makeProps({ gcBypassed: true })} />);
    const node = container.querySelector(".gc-flow-node");
    expect(node?.classList.contains("gc-flow-node--bypassed")).toBe(true);
    expect(container.querySelector(".gc-flow-node__bypass-badge")).not.toBeNull();
  });

  it("pinned node has gc-flow-node--pinned class and lock icon", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(<GcFlowNode {...makeProps({ gcPinned: true })} />);
    const node = container.querySelector(".gc-flow-node");
    expect(node?.classList.contains("gc-flow-node--pinned")).toBe(true);
    expect(container.querySelector(".gc-flow-node__state-lock")).not.toBeNull();
  });

  it("normal node has no state classes", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(<GcFlowNode {...makeProps({})} />);
    const node = container.querySelector(".gc-flow-node");
    expect(node?.classList.contains("gc-flow-node--muted")).toBe(false);
    expect(node?.classList.contains("gc-flow-node--bypassed")).toBe(false);
    expect(node?.classList.contains("gc-flow-node--pinned")).toBe(false);
    expect(container.querySelector(".gc-flow-node__bypass-badge")).toBeNull();
    expect(container.querySelector(".gc-flow-node__state-lock")).toBeNull();
  });

  it("muted takes precedence over bypassed in class selection", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(
      <GcFlowNode {...makeProps({ gcMuted: true, gcBypassed: true })} />,
    );
    const node = container.querySelector(".gc-flow-node");
    expect(node?.classList.contains("gc-flow-node--muted")).toBe(true);
    expect(node?.classList.contains("gc-flow-node--bypassed")).toBe(false);
  });

  it("bypass badge shows aria/title key", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(<GcFlowNode {...makeProps({ gcBypassed: true })} />);
    const badge = container.querySelector(".gc-flow-node__bypass-badge");
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute("title")).toBe("app.canvas.bypassedBadge");
  });

  it("lock badge shows aria/title key", async () => {
    const GcFlowNode = await importGcFlowNode();
    const { container } = render(<GcFlowNode {...makeProps({ gcPinned: true })} />);
    const lock = container.querySelector(".gc-flow-node__state-lock");
    expect(lock).not.toBeNull();
    expect(lock?.getAttribute("title")).toBe("app.canvas.pinnedBadge");
  });
});

describe("GcFlowNode draggable mapping via graphDocumentToFlow", () => {
  it("pinned node has draggable=false in ReactFlow data", async () => {
    const { graphDocumentToFlow } = await import("../../../graph/toReactFlow");
    const doc = {
      schemaVersion: 1,
      nodes: [
        { id: "s", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "a", type: "task", position: { x: 100, y: 0 }, data: { pinned: true } },
      ],
      edges: [],
    };
    const { nodes } = graphDocumentToFlow(doc);
    const n = nodes.find((x) => x.id === "a");
    expect(n?.draggable).toBe(false);
  });

  it("non-pinned node has draggable=undefined", async () => {
    const { graphDocumentToFlow } = await import("../../../graph/toReactFlow");
    const doc = {
      schemaVersion: 1,
      nodes: [
        { id: "s", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "a", type: "task", position: { x: 100, y: 0 }, data: {} },
      ],
      edges: [],
    };
    const { nodes } = graphDocumentToFlow(doc);
    const n = nodes.find((x) => x.id === "a");
    expect(n?.draggable).toBeUndefined();
  });
});
