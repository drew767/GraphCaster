// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@xyflow/react")>();
  return {
    ...actual,
    Handle: ({ type, id }: { type: string; id?: string; position?: string }) => (
      <div data-testid={`handle-${type}-${id ?? "unknown"}`} />
    ),
    Position: { Left: "left", Right: "right" },
  };
});

import type { NodeProps } from "@xyflow/react";

function makeRerouteProps(selected = false): NodeProps {
  return {
    id: "reroute-1",
    data: {},
    selected,
    dragging: false,
    isConnectable: true,
    positionAbsoluteX: 100,
    positionAbsoluteY: 100,
    zIndex: 1,
    type: "gcReroute",
    width: 12,
    height: 12,
    sourcePosition: undefined,
    targetPosition: undefined,
  } as unknown as NodeProps;
}

async function importRerouteNode() {
  const mod = await import("../../components/nodes/RerouteNode");
  return mod.RerouteNode;
}

describe("RerouteNode rendering", () => {
  it("renders as a small circle element", async () => {
    const RerouteNode = await importRerouteNode();
    const { container } = render(<RerouteNode {...makeRerouteProps()} />);
    const node = container.querySelector(".gc-reroute-node");
    expect(node).not.toBeNull();
  });

  it("has both target (input) and source (output) handles", async () => {
    const RerouteNode = await importRerouteNode();
    const { getByTestId } = render(<RerouteNode {...makeRerouteProps()} />);
    expect(getByTestId("handle-target-in_default")).toBeTruthy();
    expect(getByTestId("handle-source-out_default")).toBeTruthy();
  });

  it("adds selected class when selected=true", async () => {
    const RerouteNode = await importRerouteNode();
    const { container } = render(<RerouteNode {...makeRerouteProps(true)} />);
    const node = container.querySelector(".gc-reroute-node");
    expect(node?.classList.contains("gc-reroute-node--selected")).toBe(true);
  });

  it("does not add selected class when selected=false", async () => {
    const RerouteNode = await importRerouteNode();
    const { container } = render(<RerouteNode {...makeRerouteProps(false)} />);
    const node = container.querySelector(".gc-reroute-node");
    expect(node?.classList.contains("gc-reroute-node--selected")).toBe(false);
  });

  it("has aria-label Reroute", async () => {
    const RerouteNode = await importRerouteNode();
    const { container } = render(<RerouteNode {...makeRerouteProps()} />);
    const node = container.querySelector(".gc-reroute-node");
    expect(node?.getAttribute("aria-label")).toBe("Reroute");
  });
});

describe("Reroute in graphDocumentToFlow", () => {
  it("reroute node maps to gcReroute React Flow type", async () => {
    const { graphDocumentToFlow } = await import("../../graph/toReactFlow");
    const doc = {
      schemaVersion: 1,
      nodes: [
        { id: "s", type: "start", position: { x: 0, y: 0 }, data: {} },
        { id: "r1", type: "reroute", position: { x: 100, y: 100 }, data: {} },
      ],
      edges: [],
    };
    const { nodes } = graphDocumentToFlow(doc);
    const r = nodes.find((n) => n.id === "r1");
    expect(r?.type).toBe("gcReroute");
  });

  it("reroute node has 12x12 style dimensions", async () => {
    const { graphDocumentToFlow } = await import("../../graph/toReactFlow");
    const doc = {
      schemaVersion: 1,
      nodes: [{ id: "r1", type: "reroute", position: { x: 50, y: 50 }, data: {} }],
      edges: [],
    };
    const { nodes } = graphDocumentToFlow(doc);
    const r = nodes.find((n) => n.id === "r1");
    expect(r?.style?.width).toBe(12);
    expect(r?.style?.height).toBe(12);
  });
});
