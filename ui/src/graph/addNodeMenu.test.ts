// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import {
  ADD_MENU_PRIMITIVE_ORDER,
  type AddMenuPrimitiveType,
  computeAddNodeMenuLists,
  primitivesForAddNodeCategory,
} from "./addNodeMenu";
import {
  GRAPH_NODE_TYPE_AI_ROUTE,
  GRAPH_NODE_TYPE_COMMENT,
  GRAPH_NODE_TYPE_EXIT,
  GRAPH_NODE_TYPE_FORK,
  GRAPH_NODE_TYPE_MERGE,
  GRAPH_NODE_TYPE_MCP_TOOL,
  GRAPH_NODE_TYPE_LLM_AGENT,
  GRAPH_NODE_TYPE_START,
  GRAPH_NODE_TYPE_TASK,
} from "./nodeKinds";

function labelEcho(ty: AddMenuPrimitiveType): string {
  return ty;
}

describe("primitivesForAddNodeCategory", () => {
  it("all returns full order", () => {
    expect(primitivesForAddNodeCategory("all")).toEqual(ADD_MENU_PRIMITIVE_ORDER);
  });

  it("flow is start exit fork merge", () => {
    const got = new Set(primitivesForAddNodeCategory("flow"));
    expect(got.has(GRAPH_NODE_TYPE_START)).toBe(true);
    expect(got.has(GRAPH_NODE_TYPE_EXIT)).toBe(true);
    expect(got.has(GRAPH_NODE_TYPE_FORK)).toBe(true);
    expect(got.has(GRAPH_NODE_TYPE_MERGE)).toBe(true);
    expect(got.size).toBe(4);
  });

  it("steps is task, ai_route, mcp_tool, and llm_agent", () => {
    expect(primitivesForAddNodeCategory("steps")).toEqual([
      GRAPH_NODE_TYPE_TASK,
      GRAPH_NODE_TYPE_AI_ROUTE,
      GRAPH_NODE_TYPE_MCP_TOOL,
      GRAPH_NODE_TYPE_LLM_AGENT,
    ]);
  });

  it("nested is empty primitives", () => {
    expect(primitivesForAddNodeCategory("nested")).toEqual([]);
  });

  it("notes is comment only", () => {
    expect(primitivesForAddNodeCategory("notes")).toEqual([GRAPH_NODE_TYPE_COMMENT]);
  });
});

describe("computeAddNodeMenuLists", () => {
  const graphs = [
    { fileName: "a.json", graphId: "g1", label: "Alpha" },
    { fileName: "b.json", graphId: "g2", label: "Beta" },
  ];

  it("all includes graphs and primitives", () => {
    const { primitiveOptions, graphOptions } = computeAddNodeMenuLists({
      category: "all",
      filterText: "",
      hasStartNode: false,
      workspaceGraphs: graphs,
      labelForPrimitive: labelEcho,
    });
    expect(primitiveOptions.length).toBe(ADD_MENU_PRIMITIVE_ORDER.length);
    expect(graphOptions).toEqual(graphs);
  });

  it("flow hides graphs and non-flow primitives", () => {
    const { primitiveOptions, graphOptions } = computeAddNodeMenuLists({
      category: "flow",
      filterText: "",
      hasStartNode: false,
      workspaceGraphs: graphs,
      labelForPrimitive: labelEcho,
    });
    expect(graphOptions).toEqual([]);
    expect(primitiveOptions).not.toContain(GRAPH_NODE_TYPE_TASK);
    expect(primitiveOptions).toContain(GRAPH_NODE_TYPE_EXIT);
  });

  it("nested shows only graphs", () => {
    const { primitiveOptions, graphOptions } = computeAddNodeMenuLists({
      category: "nested",
      filterText: "",
      hasStartNode: false,
      workspaceGraphs: graphs,
      labelForPrimitive: labelEcho,
    });
    expect(primitiveOptions).toEqual([]);
    expect(graphOptions).toEqual(graphs);
  });

  it("hasStartNode removes start from flow", () => {
    const { primitiveOptions } = computeAddNodeMenuLists({
      category: "flow",
      filterText: "",
      hasStartNode: true,
      workspaceGraphs: graphs,
      labelForPrimitive: labelEcho,
    });
    expect(primitiveOptions).not.toContain(GRAPH_NODE_TYPE_START);
  });

  it("text filter narrows primitives", () => {
    const { primitiveOptions } = computeAddNodeMenuLists({
      category: "all",
      filterText: "task",
      hasStartNode: false,
      workspaceGraphs: graphs,
      labelForPrimitive: labelEcho,
    });
    expect(primitiveOptions).toEqual([GRAPH_NODE_TYPE_TASK]);
  });
});
