// Copyright GraphCaster. All Rights Reserved.

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

export const ADD_MENU_PRIMITIVE_ORDER = [
  GRAPH_NODE_TYPE_START,
  GRAPH_NODE_TYPE_EXIT,
  GRAPH_NODE_TYPE_TASK,
  GRAPH_NODE_TYPE_AI_ROUTE,
  GRAPH_NODE_TYPE_MCP_TOOL,
  GRAPH_NODE_TYPE_LLM_AGENT,
  GRAPH_NODE_TYPE_MERGE,
  GRAPH_NODE_TYPE_FORK,
  GRAPH_NODE_TYPE_COMMENT,
] as const;

export type AddMenuPrimitiveType = (typeof ADD_MENU_PRIMITIVE_ORDER)[number];

export type AddNodeMenuPick =
  | { kind: "primitive"; nodeType: AddMenuPrimitiveType }
  | { kind: "graph_ref"; targetGraphId: string }
  | { kind: "task_cursor_agent" };

export type WorkspaceGraphAddMenuRow = {
  fileName: string;
  graphId: string;
  label: string;
};

export const ADD_NODE_CATEGORY_ORDER = ["all", "flow", "steps", "nested", "notes"] as const;

export type AddNodeCategoryId = (typeof ADD_NODE_CATEGORY_ORDER)[number];

const FLOW_PRIMITIVE_TYPES: ReadonlySet<AddMenuPrimitiveType> = new Set([
  GRAPH_NODE_TYPE_START,
  GRAPH_NODE_TYPE_EXIT,
  GRAPH_NODE_TYPE_FORK,
  GRAPH_NODE_TYPE_MERGE,
]);

const STEP_PRIMITIVE_TYPES: ReadonlySet<AddMenuPrimitiveType> = new Set([
  GRAPH_NODE_TYPE_TASK,
  GRAPH_NODE_TYPE_AI_ROUTE,
  GRAPH_NODE_TYPE_MCP_TOOL,
  GRAPH_NODE_TYPE_LLM_AGENT,
]);

export function primitivesForAddNodeCategory(category: AddNodeCategoryId): readonly AddMenuPrimitiveType[] {
  switch (category) {
    case "all":
      return ADD_MENU_PRIMITIVE_ORDER;
    case "flow":
      return ADD_MENU_PRIMITIVE_ORDER.filter((ty) => {
        return FLOW_PRIMITIVE_TYPES.has(ty);
      });
    case "steps":
      return ADD_MENU_PRIMITIVE_ORDER.filter((ty) => {
        return STEP_PRIMITIVE_TYPES.has(ty);
      });
    case "nested":
      return [];
    case "notes":
      return ADD_MENU_PRIMITIVE_ORDER.filter((ty) => {
        return ty === GRAPH_NODE_TYPE_COMMENT;
      });
    default: {
      return ADD_MENU_PRIMITIVE_ORDER;
    }
  }
}

export function computeAddNodeMenuLists(input: {
  category: AddNodeCategoryId;
  filterText: string;
  hasStartNode: boolean;
  workspaceGraphs: ReadonlyArray<WorkspaceGraphAddMenuRow>;
  labelForPrimitive: (ty: AddMenuPrimitiveType) => string;
}): { primitiveOptions: AddMenuPrimitiveType[]; graphOptions: WorkspaceGraphAddMenuRow[] } {
  const q = input.filterText.trim().toLowerCase();
  let basePrimitives = [...primitivesForAddNodeCategory(input.category)];
  if (input.hasStartNode) {
    basePrimitives = basePrimitives.filter((ty) => {
      return ty !== GRAPH_NODE_TYPE_START;
    });
  }
  const primitiveOptions =
    q === ""
      ? basePrimitives
      : basePrimitives.filter((ty) => {
          const label = input.labelForPrimitive(ty).toLowerCase();
          return ty.includes(q) || label.includes(q);
        });

  const includeGraphs = input.category === "all" || input.category === "nested";
  const graphsBase = includeGraphs ? input.workspaceGraphs : [];
  const graphOptions =
    q === ""
      ? [...graphsBase]
      : graphsBase.filter((row) => {
          return (
            row.graphId.toLowerCase().includes(q) ||
            row.label.toLowerCase().includes(q) ||
            row.fileName.toLowerCase().includes(q)
          );
        });

  return { primitiveOptions, graphOptions };
}
