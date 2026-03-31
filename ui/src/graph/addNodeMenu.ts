// Copyright GraphCaster. All Rights Reserved.

import { isRegistryConnectionStructurallyFine } from "./connectionCompatibility";
import { HANDLE_IN_DEFAULT } from "./handleContract";
import {
  GRAPH_NODE_TYPE_AI_ROUTE,
  GRAPH_NODE_TYPE_COMMENT,
  GRAPH_NODE_TYPE_EXIT,
  GRAPH_NODE_TYPE_FORK,
  GRAPH_NODE_TYPE_GRAPH_REF,
  GRAPH_NODE_TYPE_GROUP,
  GRAPH_NODE_TYPE_MERGE,
  GRAPH_NODE_TYPE_MCP_TOOL,
  GRAPH_NODE_TYPE_HTTP_REQUEST,
  GRAPH_NODE_TYPE_RAG_QUERY,
  GRAPH_NODE_TYPE_DELAY,
  GRAPH_NODE_TYPE_DEBOUNCE,
  GRAPH_NODE_TYPE_WAIT_FOR,
  GRAPH_NODE_TYPE_SET_VARIABLE,
  GRAPH_NODE_TYPE_PYTHON_CODE,
  GRAPH_NODE_TYPE_LLM_AGENT,
  GRAPH_NODE_TYPE_START,
  GRAPH_NODE_TYPE_TASK,
} from "./nodeKinds";
import { type NodeTemplateId, filterNodeTemplateIds } from "./nodeTemplates";

export const ADD_MENU_PRIMITIVE_ORDER = [
  GRAPH_NODE_TYPE_START,
  GRAPH_NODE_TYPE_EXIT,
  GRAPH_NODE_TYPE_TASK,
  GRAPH_NODE_TYPE_AI_ROUTE,
  GRAPH_NODE_TYPE_MCP_TOOL,
  GRAPH_NODE_TYPE_HTTP_REQUEST,
  GRAPH_NODE_TYPE_RAG_QUERY,
  GRAPH_NODE_TYPE_DELAY,
  GRAPH_NODE_TYPE_DEBOUNCE,
  GRAPH_NODE_TYPE_WAIT_FOR,
  GRAPH_NODE_TYPE_SET_VARIABLE,
  GRAPH_NODE_TYPE_PYTHON_CODE,
  GRAPH_NODE_TYPE_LLM_AGENT,
  GRAPH_NODE_TYPE_MERGE,
  GRAPH_NODE_TYPE_FORK,
  GRAPH_NODE_TYPE_COMMENT,
  GRAPH_NODE_TYPE_GROUP,
] as const;

export type AddMenuPrimitiveType = (typeof ADD_MENU_PRIMITIVE_ORDER)[number];

export type AddNodeMenuPick =
  | { kind: "primitive"; nodeType: AddMenuPrimitiveType }
  | { kind: "graph_ref"; targetGraphId: string }
  | { kind: "task_cursor_agent" }
  | { kind: "template"; templateId: string };

export type WorkspaceGraphAddMenuRow = {
  fileName: string;
  graphId: string;
  label: string;
};

export const ADD_NODE_CATEGORY_ORDER = ["all", "flow", "steps", "nested", "templates", "notes"] as const;

export type AddNodeCategoryId = (typeof ADD_NODE_CATEGORY_ORDER)[number];

/** When set, the add-node menu only lists types that can receive a wire from the given source pin. */
export type AddNodeConnectMenuFilter = {
  allowedPrimitives: ReadonlySet<AddMenuPrimitiveType>;
  allowGraphRefs: boolean;
  allowCursorAgent: boolean;
};

export function buildAddNodeConnectMenuFilter(
  sourceGraphType: string,
  sourceHandleNorm: string,
): AddNodeConnectMenuFilter {
  const allowedPrimitives = new Set<AddMenuPrimitiveType>();
  for (const ty of ADD_MENU_PRIMITIVE_ORDER) {
    if (isRegistryConnectionStructurallyFine(sourceGraphType, ty, sourceHandleNorm, HANDLE_IN_DEFAULT)) {
      allowedPrimitives.add(ty);
    }
  }
  return {
    allowedPrimitives,
    allowGraphRefs: isRegistryConnectionStructurallyFine(
      sourceGraphType,
      GRAPH_NODE_TYPE_GRAPH_REF,
      sourceHandleNorm,
      HANDLE_IN_DEFAULT,
    ),
    allowCursorAgent: isRegistryConnectionStructurallyFine(
      sourceGraphType,
      GRAPH_NODE_TYPE_TASK,
      sourceHandleNorm,
      HANDLE_IN_DEFAULT,
    ),
  };
}

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
  GRAPH_NODE_TYPE_HTTP_REQUEST,
  GRAPH_NODE_TYPE_RAG_QUERY,
  GRAPH_NODE_TYPE_DELAY,
  GRAPH_NODE_TYPE_DEBOUNCE,
  GRAPH_NODE_TYPE_WAIT_FOR,
  GRAPH_NODE_TYPE_SET_VARIABLE,
  GRAPH_NODE_TYPE_PYTHON_CODE,
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
    case "templates":
      return [];
    case "notes":
      return ADD_MENU_PRIMITIVE_ORDER.filter((ty) => {
        return ty === GRAPH_NODE_TYPE_COMMENT || ty === GRAPH_NODE_TYPE_GROUP;
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
  labelForTemplate?: (id: NodeTemplateId) => string;
  connectFilter?: AddNodeConnectMenuFilter | null;
}): {
  primitiveOptions: AddMenuPrimitiveType[];
  graphOptions: WorkspaceGraphAddMenuRow[];
  templateOptions: NodeTemplateId[];
} {
  const q = input.filterText.trim().toLowerCase();
  let basePrimitives = [...primitivesForAddNodeCategory(input.category)];
  if (input.hasStartNode) {
    basePrimitives = basePrimitives.filter((ty) => {
      return ty !== GRAPH_NODE_TYPE_START;
    });
  }
  if (input.connectFilter) {
    basePrimitives = basePrimitives.filter((ty) => {
      return input.connectFilter!.allowedPrimitives.has(ty);
    });
  }
  const primitiveOptions =
    q === ""
      ? basePrimitives
      : basePrimitives.filter((ty) => {
          const label = input.labelForPrimitive(ty).toLowerCase();
          return ty.includes(q) || label.includes(q);
        });

  const includeGraphs =
    (input.category === "all" || input.category === "nested") &&
    (!input.connectFilter || input.connectFilter.allowGraphRefs);
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

  const labelForTemplate = input.labelForTemplate ?? ((id: NodeTemplateId) => id);
  const templateOptions = filterNodeTemplateIds({
    category: input.category,
    filterText: input.filterText,
    connectFilter: input.connectFilter ?? null,
    labelForTemplate,
  });

  return { primitiveOptions, graphOptions, templateOptions };
}
