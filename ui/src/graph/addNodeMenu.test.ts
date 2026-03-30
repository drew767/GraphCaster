// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import {
  ADD_MENU_PRIMITIVE_ORDER,
  type AddMenuPrimitiveType,
  buildAddNodeConnectMenuFilter,
  computeAddNodeMenuLists,
  primitivesForAddNodeCategory,
} from "./addNodeMenu";
import { HANDLE_OUT_DEFAULT } from "./handleContract";
import {
  GRAPH_NODE_TYPE_AI_ROUTE,
  GRAPH_NODE_TYPE_COMMENT,
  GRAPH_NODE_TYPE_GROUP,
  GRAPH_NODE_TYPE_EXIT,
  GRAPH_NODE_TYPE_FORK,
  GRAPH_NODE_TYPE_MERGE,
  GRAPH_NODE_TYPE_MCP_TOOL,
  GRAPH_NODE_TYPE_HTTP_REQUEST,
  GRAPH_NODE_TYPE_RAG_QUERY,
  GRAPH_NODE_TYPE_DELAY,
  GRAPH_NODE_TYPE_DEBOUNCE,
  GRAPH_NODE_TYPE_WAIT_FOR,
  GRAPH_NODE_TYPE_PYTHON_CODE,
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

  it("steps is task, ai_route, mcp_tool, http_request, rag_query, timer nodes, python_code, and llm_agent", () => {
    expect(primitivesForAddNodeCategory("steps")).toEqual([
      GRAPH_NODE_TYPE_TASK,
      GRAPH_NODE_TYPE_AI_ROUTE,
      GRAPH_NODE_TYPE_MCP_TOOL,
      GRAPH_NODE_TYPE_HTTP_REQUEST,
      GRAPH_NODE_TYPE_RAG_QUERY,
      GRAPH_NODE_TYPE_DELAY,
      GRAPH_NODE_TYPE_DEBOUNCE,
      GRAPH_NODE_TYPE_WAIT_FOR,
      GRAPH_NODE_TYPE_PYTHON_CODE,
      GRAPH_NODE_TYPE_LLM_AGENT,
    ]);
  });

  it("nested is empty primitives", () => {
    expect(primitivesForAddNodeCategory("nested")).toEqual([]);
  });

  it("templates category has no primitives", () => {
    expect(primitivesForAddNodeCategory("templates")).toEqual([]);
  });

  it("notes lists comment and group frames", () => {
    expect(primitivesForAddNodeCategory("notes")).toEqual([
      GRAPH_NODE_TYPE_COMMENT,
      GRAPH_NODE_TYPE_GROUP,
    ]);
  });
});

describe("computeAddNodeMenuLists", () => {
  const graphs = [
    { fileName: "a.json", graphId: "g1", label: "Alpha" },
    { fileName: "b.json", graphId: "g2", label: "Beta" },
  ];

  it("all includes graphs, primitives, and templates", () => {
    const { primitiveOptions, graphOptions, templateOptions } = computeAddNodeMenuLists({
      category: "all",
      filterText: "",
      hasStartNode: false,
      workspaceGraphs: graphs,
      labelForPrimitive: labelEcho,
    });
    expect(primitiveOptions.length).toBe(ADD_MENU_PRIMITIVE_ORDER.length);
    expect(graphOptions).toEqual(graphs);
    expect(templateOptions.length).toBe(3);
  });

  it("templates category lists only template ids", () => {
    const { primitiveOptions, graphOptions, templateOptions } = computeAddNodeMenuLists({
      category: "templates",
      filterText: "",
      hasStartNode: false,
      workspaceGraphs: graphs,
      labelForPrimitive: labelEcho,
    });
    expect(primitiveOptions).toEqual([]);
    expect(graphOptions).toEqual([]);
    expect(templateOptions.length).toBe(3);
  });

  it("flow hides graphs and non-flow primitives", () => {
    const { primitiveOptions, graphOptions, templateOptions } = computeAddNodeMenuLists({
      category: "flow",
      filterText: "",
      hasStartNode: false,
      workspaceGraphs: graphs,
      labelForPrimitive: labelEcho,
    });
    expect(graphOptions).toEqual([]);
    expect(templateOptions).toEqual([]);
    expect(primitiveOptions).not.toContain(GRAPH_NODE_TYPE_TASK);
    expect(primitiveOptions).toContain(GRAPH_NODE_TYPE_EXIT);
  });

  it("nested shows only graphs", () => {
    const { primitiveOptions, graphOptions, templateOptions } = computeAddNodeMenuLists({
      category: "nested",
      filterText: "",
      hasStartNode: false,
      workspaceGraphs: graphs,
      labelForPrimitive: labelEcho,
    });
    expect(primitiveOptions).toEqual([]);
    expect(graphOptions).toEqual(graphs);
    expect(templateOptions).toEqual([]);
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

  it("connectFilter limits primitives and hides graphs when disallowed", () => {
    const filter = buildAddNodeConnectMenuFilter(GRAPH_NODE_TYPE_START, HANDLE_OUT_DEFAULT);
    expect(filter.allowedPrimitives.has(GRAPH_NODE_TYPE_START)).toBe(false);
    expect(filter.allowedPrimitives.has(GRAPH_NODE_TYPE_COMMENT)).toBe(false);
    expect(filter.allowedPrimitives.has(GRAPH_NODE_TYPE_EXIT)).toBe(true);
    expect(filter.allowGraphRefs).toBe(true);

    const { primitiveOptions, graphOptions, templateOptions } = computeAddNodeMenuLists({
      category: "all",
      filterText: "",
      hasStartNode: false,
      workspaceGraphs: graphs,
      labelForPrimitive: labelEcho,
      connectFilter: {
        allowedPrimitives: new Set([GRAPH_NODE_TYPE_TASK, GRAPH_NODE_TYPE_EXIT]),
        allowGraphRefs: false,
        allowCursorAgent: false,
      },
    });
    expect(primitiveOptions).toEqual([GRAPH_NODE_TYPE_EXIT, GRAPH_NODE_TYPE_TASK]);
    expect(graphOptions).toEqual([]);
    expect(templateOptions).toEqual([]);
  });
});

describe("buildAddNodeConnectMenuFilter", () => {
  it("from start default out: exit and executors, not start/comment/group", () => {
    const f = buildAddNodeConnectMenuFilter(GRAPH_NODE_TYPE_START, HANDLE_OUT_DEFAULT);
    expect(f.allowedPrimitives.has(GRAPH_NODE_TYPE_START)).toBe(false);
    expect(f.allowedPrimitives.has(GRAPH_NODE_TYPE_COMMENT)).toBe(false);
    expect(f.allowedPrimitives.has(GRAPH_NODE_TYPE_GROUP)).toBe(false);
    expect(f.allowedPrimitives.has(GRAPH_NODE_TYPE_EXIT)).toBe(true);
    expect(f.allowedPrimitives.has(GRAPH_NODE_TYPE_TASK)).toBe(true);
  });
});
