// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it, vi } from "vitest";
import type { Edge, Node } from "@xyflow/react";

import {
  isGcFlowConnectionAllowed,
  isRegistryConnectionStructurallyFine,
} from "./connectionCompatibility";
import * as portKindCompat from "./portDataKindCompat";
import type { GcNodeData } from "./toReactFlow";

function node(
  id: string,
  graphKind: string,
  rfType: string = "gcNode",
): Node<GcNodeData> {
  return {
    id,
    type: rfType,
    position: { x: 0, y: 0 },
    data: { graphNodeType: graphKind, label: id, raw: {} },
  };
}

describe("isRegistryConnectionStructurallyFine", () => {
  it("allows task out_default → task in_default", () => {
    expect(isRegistryConnectionStructurallyFine("task", "task", "out_default", "in_default")).toBe(
      true,
    );
  });

  it("rejects start as target (no in_default)", () => {
    expect(isRegistryConnectionStructurallyFine("task", "start", "out_default", "in_default")).toBe(
      false,
    );
  });

  it("rejects invalid source handle on start", () => {
    expect(isRegistryConnectionStructurallyFine("start", "task", "out_error", "in_default")).toBe(
      false,
    );
  });

  it("rejects exit as source", () => {
    expect(isRegistryConnectionStructurallyFine("exit", "task", "out_default", "in_default")).toBe(
      false,
    );
  });
});

describe("isGcFlowConnectionAllowed", () => {
  const start = node("s1", "start");
  const taskA = node("t1", "task");
  const taskB = node("t2", "task");
  const exit = node("e1", "exit");

  it("allows start out_default → task in_default", () => {
    expect(
      isGcFlowConnectionAllowed(
        { source: "s1", target: "t1", sourceHandle: "out_default", targetHandle: "in_default" },
        [start, taskA],
        [],
      ),
    ).toBe(true);
  });

  it("rejects self-loop", () => {
    expect(
      isGcFlowConnectionAllowed(
        { source: "t1", target: "t1", sourceHandle: "out_default", targetHandle: "in_default" },
        [taskA],
        [],
      ),
    ).toBe(false);
  });

  it("rejects connection involving frame node types", () => {
    const comment = node("c1", "comment", "gcComment");
    expect(
      isGcFlowConnectionAllowed(
        { source: "s1", target: "c1", sourceHandle: "out_default", targetHandle: "in_default" },
        [start, comment],
        [],
      ),
    ).toBe(false);
  });

  it("rejects duplicate parallel edge", () => {
    const edges: Edge[] = [
      {
        id: "ex",
        source: "s1",
        target: "t1",
        sourceHandle: "out_default",
        targetHandle: "in_default",
      },
    ];
    expect(
      isGcFlowConnectionAllowed(
        { source: "s1", target: "t1", sourceHandle: "out_default", targetHandle: "in_default" },
        [start, taskA],
        edges,
      ),
    ).toBe(false);
  });

  it("allows task → exit", () => {
    expect(
      isGcFlowConnectionAllowed(
        { source: "t1", target: "e1", sourceHandle: "out_default", targetHandle: "in_default" },
        [taskA, exit],
        [],
      ),
    ).toBe(true);
  });

  it("rejects when classifyPortKindPair returns block (future kinds)", () => {
    const spy = vi.spyOn(portKindCompat, "classifyPortKindPair").mockReturnValue("block");
    try {
      expect(
        isGcFlowConnectionAllowed(
          { source: "s1", target: "t1", sourceHandle: "out_default", targetHandle: "in_default" },
          [start, taskA],
          [],
        ),
      ).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("treats empty sourceHandle as out_default", () => {
    expect(
      isGcFlowConnectionAllowed(
        { source: "s1", target: "t1", sourceHandle: null, targetHandle: "in_default" },
        [start, taskA],
        [],
      ),
    ).toBe(true);
  });

  it("allows second edge same nodes different handles (out_error)", () => {
    const edges: Edge[] = [
      {
        id: "e1",
        source: "t1",
        target: "t2",
        sourceHandle: "out_default",
        targetHandle: "in_default",
      },
    ];
    expect(
      isGcFlowConnectionAllowed(
        { source: "t1", target: "t2", sourceHandle: "out_error", targetHandle: "in_default" },
        [taskA, taskB],
        edges,
      ),
    ).toBe(true);
  });
});
