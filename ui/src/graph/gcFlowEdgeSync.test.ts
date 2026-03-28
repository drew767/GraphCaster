// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import type { Edge } from "@xyflow/react";

import {
  gcFlowEdgeDocumentPayloadEqual,
  gcFlowEdgesSyncKeepSelection,
} from "./gcFlowEdgeSync";

describe("gcFlowEdgeDocumentPayloadEqual", () => {
  it("returns true for identical payload (className ignored by caller pairing)", () => {
    const a: Edge = {
      id: "e1",
      source: "a",
      target: "b",
      sourceHandle: "out_default",
      targetHandle: "in_default",
      data: { routeDescription: "x" },
    };
    const b: Edge = { ...a, className: " gc-edge--warning " };
    expect(gcFlowEdgeDocumentPayloadEqual(a, b)).toBe(true);
  });

  it("returns false when data changes", () => {
    const a: Edge = {
      id: "e1",
      source: "a",
      target: "b",
      sourceHandle: "out_default",
      targetHandle: "in_default",
      data: { routeDescription: "x" },
    };
    const b: Edge = { ...a, data: { routeDescription: "y" } };
    expect(gcFlowEdgeDocumentPayloadEqual(a, b)).toBe(false);
  });

  it("returns true when data keys differ only in order", () => {
    const a: Edge = {
      id: "e1",
      source: "a",
      target: "b",
      sourceHandle: "out_default",
      targetHandle: "in_default",
      data: { routeDescription: "x", z: 1 },
    };
    const b: Edge = {
      ...a,
      data: { z: 1, routeDescription: "x" },
    };
    expect(gcFlowEdgeDocumentPayloadEqual(a, b)).toBe(true);
  });
});

describe("gcFlowEdgesSyncKeepSelection", () => {
  it("preserves selected when payload row matches by index and id", () => {
    const prev: Edge[] = [
      {
        id: "e1",
        source: "a",
        target: "b",
        selected: true,
        sourceHandle: "out_default",
        targetHandle: "in_default",
      },
    ];
    const next: Edge[] = [
      {
        id: "e1",
        source: "a",
        target: "b",
        sourceHandle: "out_default",
        targetHandle: "in_default",
        label: "edge label",
      },
    ];
    const out = gcFlowEdgesSyncKeepSelection(prev, next);
    expect(out[0]?.selected).toBe(true);
    expect(out[0]?.label).toBe("edge label");
  });

  it("preserves selected when next reorders edges by id", () => {
    const prev: Edge[] = [
      {
        id: "e1",
        source: "a",
        target: "b",
        selected: true,
        sourceHandle: "out_default",
        targetHandle: "in_default",
      },
      {
        id: "e2",
        source: "b",
        target: "c",
        sourceHandle: "out_default",
        targetHandle: "in_default",
      },
    ];
    const next: Edge[] = [
      {
        id: "e2",
        source: "b",
        target: "c",
        sourceHandle: "out_default",
        targetHandle: "in_default",
      },
      {
        id: "e1",
        source: "a",
        target: "b",
        sourceHandle: "out_default",
        targetHandle: "in_default",
      },
    ];
    const out = gcFlowEdgesSyncKeepSelection(prev, next);
    expect(out.find((e) => e.id === "e1")?.selected).toBe(true);
    expect(out.find((e) => e.id === "e2")?.selected).not.toBe(true);
  });
});
