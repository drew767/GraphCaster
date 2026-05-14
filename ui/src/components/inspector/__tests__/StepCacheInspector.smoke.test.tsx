// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

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
  runSessionAppendLine: vi.fn(),
}));

vi.mock("../../../run/stepCacheDirtyStore", () => ({
  getStepCacheDirtySnapshot: () => ({ ids: [] }),
  markStepCacheDirtyTransitive: vi.fn(),
}));

const { StepCacheInspector } = await import("../StepCacheInspector");

function makeDoc(): GraphDocumentJson {
  return {
    schemaVersion: 1,
    meta: { schemaVersion: 1, graphId: "g-1", title: "Test" },
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    edges: [],
  };
}

describe("StepCacheInspector smoke", () => {
  it("renders the heading, toggle and mark dirty button by default", () => {
    render(
      <StepCacheInspector
        nodeId="task-1"
        raw={{}}
        runLocked={false}
        graphDocument={makeDoc()}
        onApplyNodeData={() => {}}
      />,
    );
    expect(screen.getByText("app.inspector.stepCacheHeading")).toBeDefined();
    expect(screen.getByText("app.inspector.stepCacheEnabled")).toBeDefined();
    expect(screen.getByText("app.inspector.stepCacheMarkDirty")).toBeDefined();
  });

  it("hides the mark dirty button when hideMarkDirtyButton is true", () => {
    render(
      <StepCacheInspector
        nodeId="task-1"
        raw={{}}
        runLocked={false}
        graphDocument={makeDoc()}
        onApplyNodeData={() => {}}
        hideMarkDirtyButton
      />,
    );
    expect(screen.queryByText("app.inspector.stepCacheMarkDirty")).toBeNull();
  });
});
