// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import {
  GRAPH_NODE_TYPE_AI_ROUTE,
  GRAPH_NODE_TYPE_COMMENT,
  GRAPH_NODE_TYPE_LLM_AGENT,
  GRAPH_NODE_TYPE_MERGE,
  GRAPH_NODE_TYPE_TASK,
} from "./nodeKinds";
import {
  buildSuccessPathAdjacency,
  collectDownstreamNodeIds,
  nodeTypeTriggersStepCacheDirtyOnDataEdit,
  transitiveStepCacheDirtyNodeIds,
} from "./stepCacheDirtyGraph";
import type { GraphDocumentJson } from "./types";
import { EDGE_SOURCE_OUT_ERROR } from "./normalizeHandles";

function docWith(
  nodes: GraphDocumentJson["nodes"],
  edges: GraphDocumentJson["edges"],
): GraphDocumentJson {
  return { nodes: nodes ?? [], edges: edges ?? [] };
}

describe("stepCacheDirtyGraph", () => {
  it("nodeTypeTriggersStepCacheDirtyOnDataEdit skips comment only", () => {
    expect(nodeTypeTriggersStepCacheDirtyOnDataEdit(GRAPH_NODE_TYPE_COMMENT)).toBe(false);
    expect(nodeTypeTriggersStepCacheDirtyOnDataEdit(GRAPH_NODE_TYPE_TASK)).toBe(true);
    expect(nodeTypeTriggersStepCacheDirtyOnDataEdit(GRAPH_NODE_TYPE_AI_ROUTE)).toBe(true);
    expect(nodeTypeTriggersStepCacheDirtyOnDataEdit(GRAPH_NODE_TYPE_LLM_AGENT)).toBe(true);
    expect(nodeTypeTriggersStepCacheDirtyOnDataEdit(undefined)).toBe(false);
    expect(nodeTypeTriggersStepCacheDirtyOnDataEdit("")).toBe(false);
  });

  it("linear with ai_route (stepCache): seed reaches downstream cached nodes", () => {
    const doc = docWith(
      [
        { id: "a", type: GRAPH_NODE_TYPE_AI_ROUTE, data: { stepCache: true } },
        { id: "b", type: GRAPH_NODE_TYPE_TASK, data: { stepCache: true } },
      ],
      [{ id: "e1", source: "a", target: "b" }],
    );
    expect(transitiveStepCacheDirtyNodeIds(doc, ["a"])).toEqual(["a", "b"]);
  });

  it("linear with llm_agent (stepCache): seed reaches downstream cached nodes", () => {
    const doc = docWith(
      [
        { id: "a", type: GRAPH_NODE_TYPE_LLM_AGENT, data: { stepCache: true } },
        { id: "b", type: GRAPH_NODE_TYPE_TASK, data: { stepCache: true } },
      ],
      [{ id: "e1", source: "a", target: "b" }],
    );
    expect(transitiveStepCacheDirtyNodeIds(doc, ["a"])).toEqual(["a", "b"]);
  });

  it("linear a→b→c: seed a reaches a,b,c", () => {
    const doc = docWith(
      [
        { id: "a", type: GRAPH_NODE_TYPE_TASK, data: { stepCache: true } },
        { id: "b", type: GRAPH_NODE_TYPE_TASK, data: { stepCache: true } },
        { id: "c", type: GRAPH_NODE_TYPE_TASK, data: { stepCache: true } },
      ],
      [
        { id: "e1", source: "a", target: "b" },
        { id: "e2", source: "b", target: "c" },
      ],
    );
    const adj = buildSuccessPathAdjacency(doc);
    expect(collectDownstreamNodeIds(adj, ["a"])).toEqual(["a", "b", "c"]);
    expect(transitiveStepCacheDirtyNodeIds(doc, ["a"])).toEqual(["a", "b", "c"]);
  });

  it("diamond: seed a reaches d", () => {
    const doc = docWith(
      [
        { id: "a", type: GRAPH_NODE_TYPE_TASK, data: { stepCache: true } },
        { id: "b", type: GRAPH_NODE_TYPE_TASK, data: { stepCache: true } },
        { id: "c", type: GRAPH_NODE_TYPE_TASK, data: { stepCache: true } },
        { id: "d", type: GRAPH_NODE_TYPE_TASK, data: { stepCache: true } },
      ],
      [
        { id: "e1", source: "a", target: "b" },
        { id: "e2", source: "a", target: "c" },
        { id: "e3", source: "b", target: "d" },
        { id: "e4", source: "c", target: "d" },
      ],
    );
    const adj = buildSuccessPathAdjacency(doc);
    expect(collectDownstreamNodeIds(adj, ["a"]).sort()).toEqual(["a", "b", "c", "d"].sort());
    expect(transitiveStepCacheDirtyNodeIds(doc, ["a"]).sort()).toEqual(["a", "b", "c", "d"].sort());
  });

  it("excludes out_error edges from forward adjacency", () => {
    const doc = docWith(
      [
        { id: "a", type: GRAPH_NODE_TYPE_TASK, data: { stepCache: true } },
        { id: "b", type: GRAPH_NODE_TYPE_TASK, data: { stepCache: true } },
      ],
      [
        { id: "e_ok", source: "a", target: "b", sourceHandle: "out_default" },
        {
          id: "e_err",
          source: "a",
          target: "b",
          sourceHandle: EDGE_SOURCE_OUT_ERROR,
        },
      ],
    );
    const adj = buildSuccessPathAdjacency(doc);
    expect(adj.get("a")).toEqual(["b"]);
    expect(collectDownstreamNodeIds(adj, ["a"])).toEqual(["a", "b"]);
  });

  it("cycle a→b→a terminates", () => {
    const doc = docWith(
      [
        { id: "a", type: GRAPH_NODE_TYPE_TASK, data: { stepCache: true } },
        { id: "b", type: GRAPH_NODE_TYPE_TASK, data: { stepCache: true } },
      ],
      [
        { id: "e1", source: "a", target: "b" },
        { id: "e2", source: "b", target: "a" },
      ],
    );
    const adj = buildSuccessPathAdjacency(doc);
    expect(collectDownstreamNodeIds(adj, ["a"]).sort()).toEqual(["a", "b"].sort());
  });

  it("traverses through non-task merge but filter drops merge from dirty ids", () => {
    const doc = docWith(
      [
        { id: "a", type: GRAPH_NODE_TYPE_TASK, data: { stepCache: true } },
        { id: "m", type: GRAPH_NODE_TYPE_MERGE, data: { mode: "barrier" } },
        { id: "t", type: GRAPH_NODE_TYPE_TASK, data: { stepCache: true } },
      ],
      [
        { id: "e1", source: "a", target: "m" },
        { id: "e2", source: "m", target: "t" },
      ],
    );
    expect(transitiveStepCacheDirtyNodeIds(doc, ["a"])).toEqual(["a", "t"]);
  });
});
