// Copyright GraphCaster. All Rights Reserved.

/**
 * Static port data kinds (F18 phase 1). Keep in sync with `python/graph_caster/port_data_kinds.py`.
 * Langflow-style single place for edge typing; Dify-style table keyed by `node.type` + handle id.
 *
 * Only lists node types that can legally carry the handle under `handleContract` (e.g. no `exit`
 * as source for `out_default`, no `start` as target for `in_default`). Unknown types stay `any`.
 */

import {
  GRAPH_NODE_TYPE_AI_ROUTE,
  GRAPH_NODE_TYPE_EXIT,
  GRAPH_NODE_TYPE_FORK,
  GRAPH_NODE_TYPE_GRAPH_REF,
  GRAPH_NODE_TYPE_MERGE,
  GRAPH_NODE_TYPE_MCP_TOOL,
  GRAPH_NODE_TYPE_LLM_AGENT,
  GRAPH_NODE_TYPE_START,
  GRAPH_NODE_TYPE_TASK,
} from "./nodeKinds";
import {
  HANDLE_IN_DEFAULT,
  HANDLE_OUT_DEFAULT,
  HANDLE_OUT_ERROR,
} from "./handleContract";

export type PortDataKind = "any" | "json" | "primitive";

/** Must match `_PORT_KIND_SET` in `python/graph_caster/port_data_kinds.py` when adding kinds. */
const PORT_KINDS: ReadonlySet<string> = new Set(["any", "json", "primitive"]);

/** F18 phase 2: parse edge `data` override; invalid values ignored (parity with `coerce_port_kind_override` in Python). */
export function coercePortKindOverride(value: unknown): PortDataKind | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const s = value.trim();
  if (PORT_KINDS.has(s)) {
    return s as PortDataKind;
  }
  return undefined;
}

/** Node types allowed to emit `out_default` (per handle contract), excluding `out_error`. */
export function portDataKindForSource(nodeType: string, handle: string): PortDataKind {
  if (handle === HANDLE_OUT_ERROR) {
    return "any";
  }
  if (handle !== HANDLE_OUT_DEFAULT) {
    return "any";
  }
  switch (nodeType) {
    case GRAPH_NODE_TYPE_START:
    case GRAPH_NODE_TYPE_TASK:
    case GRAPH_NODE_TYPE_GRAPH_REF:
    case GRAPH_NODE_TYPE_MCP_TOOL:
    case GRAPH_NODE_TYPE_LLM_AGENT:
    case GRAPH_NODE_TYPE_MERGE:
    case GRAPH_NODE_TYPE_FORK:
    case GRAPH_NODE_TYPE_AI_ROUTE:
      return "json";
    default:
      return "any";
  }
}

/** Node types allowed to accept `in_default` (per handle contract). */
export function portDataKindForTarget(nodeType: string, handle: string): PortDataKind {
  if (handle !== HANDLE_IN_DEFAULT) {
    return "any";
  }
  switch (nodeType) {
    case GRAPH_NODE_TYPE_EXIT:
    case GRAPH_NODE_TYPE_TASK:
    case GRAPH_NODE_TYPE_GRAPH_REF:
    case GRAPH_NODE_TYPE_MCP_TOOL:
    case GRAPH_NODE_TYPE_LLM_AGENT:
    case GRAPH_NODE_TYPE_MERGE:
    case GRAPH_NODE_TYPE_FORK:
    case GRAPH_NODE_TYPE_AI_ROUTE:
      return "json";
    default:
      return "any";
  }
}
