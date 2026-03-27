// Copyright GraphCaster. All Rights Reserved.

import {
  GRAPH_NODE_TYPE_COMMENT,
  GRAPH_NODE_TYPE_EXIT,
  GRAPH_NODE_TYPE_MERGE,
  GRAPH_NODE_TYPE_START,
} from "./nodeKinds";

export const ADD_MENU_PRIMITIVE_ORDER = [
  GRAPH_NODE_TYPE_START,
  GRAPH_NODE_TYPE_EXIT,
  GRAPH_NODE_TYPE_MERGE,
  GRAPH_NODE_TYPE_COMMENT,
] as const;

export type AddMenuPrimitiveType = (typeof ADD_MENU_PRIMITIVE_ORDER)[number];

export type AddNodeMenuPick =
  | { kind: "primitive"; nodeType: AddMenuPrimitiveType }
  | { kind: "graph_ref"; targetGraphId: string };

export type WorkspaceGraphAddMenuRow = {
  fileName: string;
  graphId: string;
  label: string;
};
