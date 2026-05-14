// Copyright GraphCaster. All Rights Reserved.

/**
 * Consistency checks for the unified node-types catalog (`schemas/node-types.json`).
 *
 * The Python half lives in `python/tests/test_node_types_catalog.py`.
 */

import { describe, expect, it } from "vitest";

import {
  getAllNodeTypeInfos,
  getCatalogVersion,
  getNodeTypeInfo,
  isIdempotent,
  supportsStepCache,
} from "./nodeTypesCatalog";
import {
  GRAPH_NODE_TYPE_AGENT,
  GRAPH_NODE_TYPE_AI_ROUTE,
  GRAPH_NODE_TYPE_COMMENT,
  GRAPH_NODE_TYPE_DEBOUNCE,
  GRAPH_NODE_TYPE_DELAY,
  GRAPH_NODE_TYPE_EXIT,
  GRAPH_NODE_TYPE_FORK,
  GRAPH_NODE_TYPE_GRAPH_REF,
  GRAPH_NODE_TYPE_GROUP,
  GRAPH_NODE_TYPE_HTTP_REQUEST,
  GRAPH_NODE_TYPE_LLM_AGENT,
  GRAPH_NODE_TYPE_MCP_TOOL,
  GRAPH_NODE_TYPE_MERGE,
  GRAPH_NODE_TYPE_PYTHON_CODE,
  GRAPH_NODE_TYPE_RAG_INDEX,
  GRAPH_NODE_TYPE_RAG_QUERY,
  GRAPH_NODE_TYPE_SET_VARIABLE,
  GRAPH_NODE_TYPE_START,
  GRAPH_NODE_TYPE_TASK,
  GRAPH_NODE_TYPE_TRIGGER_SCHEDULE,
  GRAPH_NODE_TYPE_TRIGGER_WEBHOOK,
  GRAPH_NODE_TYPE_WAIT_FOR,
} from "./nodeKinds";

/** Every node type exported from `nodeKinds.ts`. Keep this list in sync. */
const UI_KIND_CONSTANTS: readonly string[] = [
  GRAPH_NODE_TYPE_START,
  GRAPH_NODE_TYPE_TRIGGER_WEBHOOK,
  GRAPH_NODE_TYPE_TRIGGER_SCHEDULE,
  GRAPH_NODE_TYPE_EXIT,
  GRAPH_NODE_TYPE_TASK,
  GRAPH_NODE_TYPE_GRAPH_REF,
  GRAPH_NODE_TYPE_COMMENT,
  GRAPH_NODE_TYPE_GROUP,
  GRAPH_NODE_TYPE_MERGE,
  GRAPH_NODE_TYPE_FORK,
  GRAPH_NODE_TYPE_AI_ROUTE,
  GRAPH_NODE_TYPE_MCP_TOOL,
  GRAPH_NODE_TYPE_HTTP_REQUEST,
  GRAPH_NODE_TYPE_RAG_QUERY,
  GRAPH_NODE_TYPE_RAG_INDEX,
  GRAPH_NODE_TYPE_DELAY,
  GRAPH_NODE_TYPE_DEBOUNCE,
  GRAPH_NODE_TYPE_WAIT_FOR,
  GRAPH_NODE_TYPE_SET_VARIABLE,
  GRAPH_NODE_TYPE_PYTHON_CODE,
  GRAPH_NODE_TYPE_LLM_AGENT,
  GRAPH_NODE_TYPE_AGENT,
];

describe("nodeTypesCatalog", () => {
  it("loads catalog with a version and at least one entry", () => {
    expect(getCatalogVersion()).toBeGreaterThanOrEqual(1);
    expect(getAllNodeTypeInfos().length).toBeGreaterThan(0);
  });

  it("each UI kind constant from nodeKinds.ts is present in the catalog", () => {
    const missing = UI_KIND_CONSTANTS.filter((t) => getNodeTypeInfo(t) === undefined);
    expect(missing).toEqual([]);
  });

  it("every catalog entry marked 'ui' is exported from nodeKinds.ts", () => {
    const uiSet = new Set(UI_KIND_CONSTANTS);
    const offenders = getAllNodeTypeInfos()
      .filter((info) => info.implementedIn.includes("ui"))
      .map((info) => info.type)
      .filter((t) => !uiSet.has(t));
    expect(offenders).toEqual([]);
  });

  it("every UI kind constant is marked 'ui' in implementedIn", () => {
    const wrong: string[] = [];
    for (const t of UI_KIND_CONSTANTS) {
      const info = getNodeTypeInfo(t);
      if (info && !info.implementedIn.includes("ui")) {
        wrong.push(t);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("isIdempotent helper", () => {
    expect(isIdempotent("http_request")).toBe(false);
    expect(isIdempotent("set_variable")).toBe(true);
    expect(isIdempotent("does_not_exist")).toBe(false);
  });

  it("supportsStepCache helper", () => {
    expect(supportsStepCache("task")).toBe(true);
    expect(supportsStepCache("fork")).toBe(false);
    expect(supportsStepCache("does_not_exist")).toBe(false);
  });
});
