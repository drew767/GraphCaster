// Copyright GraphCaster. All Rights Reserved.

import type { Node } from "@xyflow/react";
import { describe, expect, it } from "vitest";

import {
  minimapBaseFillForGraphNodeType,
  minimapNodeFill,
  minimapNodeStroke,
} from "./minimapNodeColors";
import {
  GRAPH_NODE_TYPE_AI_ROUTE,
  GRAPH_NODE_TYPE_EXIT,
  GRAPH_NODE_TYPE_FORK,
  GRAPH_NODE_TYPE_GRAPH_REF,
  GRAPH_NODE_TYPE_LLM_AGENT,
  GRAPH_NODE_TYPE_AGENT,
  GRAPH_NODE_TYPE_MCP_TOOL,
  GRAPH_NODE_TYPE_HTTP_REQUEST,
  GRAPH_NODE_TYPE_RAG_QUERY,
  GRAPH_NODE_TYPE_RAG_INDEX,
  GRAPH_NODE_TYPE_DELAY,
  GRAPH_NODE_TYPE_DEBOUNCE,
  GRAPH_NODE_TYPE_WAIT_FOR,
  GRAPH_NODE_TYPE_SET_VARIABLE,
  GRAPH_NODE_TYPE_MERGE,
  GRAPH_NODE_TYPE_START,
  GRAPH_NODE_TYPE_TASK,
} from "./nodeKinds";
import type { GcNodeData } from "./toReactFlow";

function n(partial: { id: string; type?: string; data: GcNodeData }): Node<GcNodeData> {
  return {
    id: partial.id,
    type: partial.type ?? "gcNode",
    position: { x: 0, y: 0 },
    data: partial.data,
  } as Node<GcNodeData>;
}

describe("minimapNodeColors", () => {
  it("maps executable kinds to CSS-aligned hex fills", () => {
    expect(minimapBaseFillForGraphNodeType(GRAPH_NODE_TYPE_START)).toBe("#34c759");
    expect(minimapBaseFillForGraphNodeType(GRAPH_NODE_TYPE_EXIT)).toBe("#ff3b30");
    expect(minimapBaseFillForGraphNodeType(GRAPH_NODE_TYPE_TASK)).toBe("#3b82f6");
    expect(minimapBaseFillForGraphNodeType(GRAPH_NODE_TYPE_LLM_AGENT)).toBe("#5ac8fa");
    expect(minimapBaseFillForGraphNodeType(GRAPH_NODE_TYPE_AGENT)).toBe("#10b981");
    expect(minimapBaseFillForGraphNodeType(GRAPH_NODE_TYPE_GRAPH_REF)).toBe("#af52de");
    expect(minimapBaseFillForGraphNodeType(GRAPH_NODE_TYPE_MERGE)).toBe("#0a84ff");
    expect(minimapBaseFillForGraphNodeType(GRAPH_NODE_TYPE_FORK)).toBe("#34c759");
    expect(minimapBaseFillForGraphNodeType(GRAPH_NODE_TYPE_AI_ROUTE)).toBe("#f5b041");
    expect(minimapBaseFillForGraphNodeType(GRAPH_NODE_TYPE_MCP_TOOL)).toBe("#ff9f0a");
    expect(minimapBaseFillForGraphNodeType(GRAPH_NODE_TYPE_HTTP_REQUEST)).toBe("#06b6d4");
    expect(minimapBaseFillForGraphNodeType(GRAPH_NODE_TYPE_RAG_QUERY)).toBe("#8b5cf6");
    expect(minimapBaseFillForGraphNodeType(GRAPH_NODE_TYPE_RAG_INDEX)).toBe("#7c3aed");
    expect(minimapBaseFillForGraphNodeType(GRAPH_NODE_TYPE_DELAY)).toBe("#64748b");
    expect(minimapBaseFillForGraphNodeType(GRAPH_NODE_TYPE_DEBOUNCE)).toBe("#f59e0b");
    expect(minimapBaseFillForGraphNodeType(GRAPH_NODE_TYPE_WAIT_FOR)).toBe("#14b8a6");
    expect(minimapBaseFillForGraphNodeType(GRAPH_NODE_TYPE_SET_VARIABLE)).toBe("#d946ef");
    expect(minimapBaseFillForGraphNodeType("weird")).toBe("#e2e2e2");
  });

  it("uses frame fills for gcComment / gcGroup React Flow types", () => {
    expect(
      minimapNodeFill(
        n({
          id: "c1",
          type: "gcComment",
          data: { graphNodeType: "comment", label: "", raw: {} },
        }),
      ),
    ).toBe("#e8eef8");
    expect(
      minimapNodeFill(
        n({
          id: "g1",
          type: "gcGroup",
          data: { graphNodeType: "group", label: "", raw: {} },
        }),
      ),
    ).toBe("#e8e8ea");
  });

  it("does not tint comment/group frames when runOverlayPhase is set", () => {
    const plain = minimapNodeFill(
      n({
        id: "c1",
        type: "gcComment",
        data: { graphNodeType: "comment", label: "", raw: {} },
      }),
    );
    const withPhase = minimapNodeFill(
      n({
        id: "c1",
        type: "gcComment",
        data: { graphNodeType: "comment", label: "", raw: {}, runOverlayPhase: "success" },
      }),
    );
    expect(withPhase).toBe(plain);
    expect(withPhase).toBe("#e8eef8");
  });

  it("tints fill when runOverlayPhase is set on executable nodes", () => {
    const base = minimapNodeFill(n({ id: "t1", data: { graphNodeType: "task", label: "", raw: {} } }));
    for (const phase of ["success", "running", "failed", "skipped"] as const) {
      const tinted = minimapNodeFill(
        n({
          id: "t1",
          data: { graphNodeType: "task", label: "", raw: {}, runOverlayPhase: phase },
        }),
      );
      expect(tinted).not.toBe(base);
    }
  });

  it("stroke is darker than fill", () => {
    const node = n({
      id: "x",
      data: { graphNodeType: GRAPH_NODE_TYPE_TASK, label: "", raw: {} },
    });
    const fill = minimapNodeFill(node);
    const stroke = minimapNodeStroke(node);
    expect(stroke).not.toBe(fill);
    expect(stroke.startsWith("#")).toBe(true);
  });
});
