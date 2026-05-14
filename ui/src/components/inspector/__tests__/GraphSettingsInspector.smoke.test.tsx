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

const { GraphSettingsInspector } = await import("../GraphSettingsInspector");

function makeDoc(): GraphDocumentJson {
  return {
    schemaVersion: 1,
    meta: { schemaVersion: 1, graphId: "g-1", title: "Test" },
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [],
    edges: [],
  };
}

describe("GraphSettingsInspector smoke", () => {
  it("renders graph metadata form labels and Apply button", () => {
    render(
      <GraphSettingsInspector
        graphDocument={makeDoc()}
        runLocked={false}
        onApplyGraphDocumentSettings={() => {}}
      />,
    );
    expect(screen.getByText("app.inspector.graphTitle")).toBeDefined();
    expect(screen.getByText("app.inspector.graphAuthor")).toBeDefined();
    expect(screen.getByText("app.inspector.graphSchemaVersion")).toBeDefined();
    expect(screen.getByText("app.inspector.applyGraph")).toBeDefined();
  });
});
