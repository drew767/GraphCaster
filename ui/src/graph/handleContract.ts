// Copyright GraphCaster. All Rights Reserved.

/**
 * Static handle contract per node kind (F18 MVP). Mirrors Python `handle_contract.py`.
 * See `doc/IMPLEMENTED_FEATURES.md` and COMPETITIVE_ANALYSIS §15 (pin typing).
 */

import {
  GRAPH_NODE_TYPE_COMMENT,
  GRAPH_NODE_TYPE_EXIT,
  GRAPH_NODE_TYPE_GRAPH_REF,
  GRAPH_NODE_TYPE_MERGE,
  GRAPH_NODE_TYPE_START,
  GRAPH_NODE_TYPE_TASK,
} from "./nodeKinds";

export type GraphHandleId = string;

export const HANDLE_IN_DEFAULT = "in_default";
export const HANDLE_OUT_DEFAULT = "out_default";
export const HANDLE_OUT_ERROR = "out_error";

const SET_START_OUT = new Set<string>([HANDLE_OUT_DEFAULT]);
const SET_EXIT_IN = new Set<string>([HANDLE_IN_DEFAULT]);
const SET_TASK_IO = new Set<string>([HANDLE_OUT_DEFAULT, HANDLE_OUT_ERROR]);
const SET_TASK_IN = new Set<string>([HANDLE_IN_DEFAULT]);
const SET_MERGE_IO = new Set<string>([HANDLE_OUT_DEFAULT]);
const SET_MERGE_IN = new Set<string>([HANDLE_IN_DEFAULT]);
const EMPTY = new Set<string>();
/** Types other than well-known executors: permissive defaults only. */
const SET_GENERIC_OUT = new Set<string>([HANDLE_OUT_DEFAULT, HANDLE_OUT_ERROR]);
const SET_GENERIC_IN = new Set<string>([HANDLE_IN_DEFAULT]);

export function allowedSourceHandles(nodeType: string): ReadonlySet<string> {
  switch (nodeType) {
    case GRAPH_NODE_TYPE_START:
      return SET_START_OUT;
    case GRAPH_NODE_TYPE_EXIT:
      return EMPTY;
    case GRAPH_NODE_TYPE_TASK:
    case GRAPH_NODE_TYPE_GRAPH_REF:
      return SET_TASK_IO;
    case GRAPH_NODE_TYPE_MERGE:
      return SET_MERGE_IO;
    case GRAPH_NODE_TYPE_COMMENT:
      return EMPTY;
    default:
      return SET_GENERIC_OUT;
  }
}

export function allowedTargetHandles(nodeType: string): ReadonlySet<string> {
  switch (nodeType) {
    case GRAPH_NODE_TYPE_START:
      return EMPTY;
    case GRAPH_NODE_TYPE_EXIT:
      return SET_EXIT_IN;
    case GRAPH_NODE_TYPE_TASK:
    case GRAPH_NODE_TYPE_GRAPH_REF:
      return SET_TASK_IN;
    case GRAPH_NODE_TYPE_MERGE:
      return SET_MERGE_IN;
    case GRAPH_NODE_TYPE_COMMENT:
      return EMPTY;
    default:
      return SET_GENERIC_IN;
  }
}

export function isExecutableCommentOrDecorativeNodeType(type: string): boolean {
  return type === GRAPH_NODE_TYPE_COMMENT;
}
