// Copyright GraphCaster. All Rights Reserved.

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
  GRAPH_NODE_TYPE_STICKY_NOTE,
  GRAPH_NODE_TYPE_TASK,
  GRAPH_NODE_TYPE_TRIGGER_SCHEDULE,
  GRAPH_NODE_TYPE_TRIGGER_WEBHOOK,
  GRAPH_NODE_TYPE_WAIT_FOR,
} from "./nodeKinds";

export type NodeCatalogCategory = "trigger" | "action" | "ai" | "flow" | "output" | "other";

export type NodeCatalogFilter = "all" | "trigger" | "action" | "ai";

export interface NodeTypeMeta {
  /** Stable graph node type id. */
  readonly type: string;
  /** i18n key under `app.canvas.nodeTypes.<type>`. */
  readonly displayNameKey: string;
  /** i18n key under `nodeSearch.descriptions.<type>` (optional). */
  readonly descriptionKey: string;
  /** Logical grouping for the popover. */
  readonly category: NodeCatalogCategory;
  /** Optional icon hint; UI may resolve via icon map or fall back. */
  readonly icon?: string;
}

const NODE_CATALOG: readonly NodeTypeMeta[] = [
  { type: GRAPH_NODE_TYPE_START, category: "trigger", icon: "play", displayNameKey: `app.canvas.nodeTypes.${GRAPH_NODE_TYPE_START}`, descriptionKey: `nodeSearch.descriptions.${GRAPH_NODE_TYPE_START}` },
  { type: GRAPH_NODE_TYPE_TRIGGER_WEBHOOK, category: "trigger", icon: "webhook", displayNameKey: `app.canvas.nodeTypes.${GRAPH_NODE_TYPE_TRIGGER_WEBHOOK}`, descriptionKey: `nodeSearch.descriptions.${GRAPH_NODE_TYPE_TRIGGER_WEBHOOK}` },
  { type: GRAPH_NODE_TYPE_TRIGGER_SCHEDULE, category: "trigger", icon: "clock", displayNameKey: `app.canvas.nodeTypes.${GRAPH_NODE_TYPE_TRIGGER_SCHEDULE}`, descriptionKey: `nodeSearch.descriptions.${GRAPH_NODE_TYPE_TRIGGER_SCHEDULE}` },

  { type: GRAPH_NODE_TYPE_TASK, category: "action", icon: "square", displayNameKey: `app.canvas.nodeTypes.${GRAPH_NODE_TYPE_TASK}`, descriptionKey: `nodeSearch.descriptions.${GRAPH_NODE_TYPE_TASK}` },
  { type: GRAPH_NODE_TYPE_HTTP_REQUEST, category: "action", icon: "globe", displayNameKey: `app.canvas.nodeTypes.${GRAPH_NODE_TYPE_HTTP_REQUEST}`, descriptionKey: `nodeSearch.descriptions.${GRAPH_NODE_TYPE_HTTP_REQUEST}` },
  { type: GRAPH_NODE_TYPE_MCP_TOOL, category: "action", icon: "tool", displayNameKey: `app.canvas.nodeTypes.${GRAPH_NODE_TYPE_MCP_TOOL}`, descriptionKey: `nodeSearch.descriptions.${GRAPH_NODE_TYPE_MCP_TOOL}` },
  { type: GRAPH_NODE_TYPE_PYTHON_CODE, category: "action", icon: "code", displayNameKey: `app.canvas.nodeTypes.${GRAPH_NODE_TYPE_PYTHON_CODE}`, descriptionKey: `nodeSearch.descriptions.${GRAPH_NODE_TYPE_PYTHON_CODE}` },
  { type: GRAPH_NODE_TYPE_SET_VARIABLE, category: "action", icon: "variable", displayNameKey: `app.canvas.nodeTypes.${GRAPH_NODE_TYPE_SET_VARIABLE}`, descriptionKey: `nodeSearch.descriptions.${GRAPH_NODE_TYPE_SET_VARIABLE}` },
  { type: GRAPH_NODE_TYPE_DELAY, category: "action", icon: "timer", displayNameKey: `app.canvas.nodeTypes.${GRAPH_NODE_TYPE_DELAY}`, descriptionKey: `nodeSearch.descriptions.${GRAPH_NODE_TYPE_DELAY}` },
  { type: GRAPH_NODE_TYPE_DEBOUNCE, category: "action", icon: "timer", displayNameKey: `app.canvas.nodeTypes.${GRAPH_NODE_TYPE_DEBOUNCE}`, descriptionKey: `nodeSearch.descriptions.${GRAPH_NODE_TYPE_DEBOUNCE}` },
  { type: GRAPH_NODE_TYPE_WAIT_FOR, category: "action", icon: "hourglass", displayNameKey: `app.canvas.nodeTypes.${GRAPH_NODE_TYPE_WAIT_FOR}`, descriptionKey: `nodeSearch.descriptions.${GRAPH_NODE_TYPE_WAIT_FOR}` },

  { type: GRAPH_NODE_TYPE_AI_ROUTE, category: "ai", icon: "brain", displayNameKey: `app.canvas.nodeTypes.${GRAPH_NODE_TYPE_AI_ROUTE}`, descriptionKey: `nodeSearch.descriptions.${GRAPH_NODE_TYPE_AI_ROUTE}` },
  { type: GRAPH_NODE_TYPE_LLM_AGENT, category: "ai", icon: "robot", displayNameKey: `app.canvas.nodeTypes.${GRAPH_NODE_TYPE_LLM_AGENT}`, descriptionKey: `nodeSearch.descriptions.${GRAPH_NODE_TYPE_LLM_AGENT}` },
  { type: GRAPH_NODE_TYPE_AGENT, category: "ai", icon: "robot", displayNameKey: `app.canvas.nodeTypes.${GRAPH_NODE_TYPE_AGENT}`, descriptionKey: `nodeSearch.descriptions.${GRAPH_NODE_TYPE_AGENT}` },
  { type: GRAPH_NODE_TYPE_RAG_QUERY, category: "ai", icon: "search", displayNameKey: `app.canvas.nodeTypes.${GRAPH_NODE_TYPE_RAG_QUERY}`, descriptionKey: `nodeSearch.descriptions.${GRAPH_NODE_TYPE_RAG_QUERY}` },
  { type: GRAPH_NODE_TYPE_RAG_INDEX, category: "ai", icon: "database", displayNameKey: `app.canvas.nodeTypes.${GRAPH_NODE_TYPE_RAG_INDEX}`, descriptionKey: `nodeSearch.descriptions.${GRAPH_NODE_TYPE_RAG_INDEX}` },

  { type: GRAPH_NODE_TYPE_FORK, category: "flow", icon: "split", displayNameKey: `app.canvas.nodeTypes.${GRAPH_NODE_TYPE_FORK}`, descriptionKey: `nodeSearch.descriptions.${GRAPH_NODE_TYPE_FORK}` },
  { type: GRAPH_NODE_TYPE_MERGE, category: "flow", icon: "merge", displayNameKey: `app.canvas.nodeTypes.${GRAPH_NODE_TYPE_MERGE}`, descriptionKey: `nodeSearch.descriptions.${GRAPH_NODE_TYPE_MERGE}` },
  { type: GRAPH_NODE_TYPE_GRAPH_REF, category: "flow", icon: "link", displayNameKey: `app.canvas.nodeTypes.${GRAPH_NODE_TYPE_GRAPH_REF}`, descriptionKey: `nodeSearch.descriptions.${GRAPH_NODE_TYPE_GRAPH_REF}` },

  { type: GRAPH_NODE_TYPE_EXIT, category: "output", icon: "stop", displayNameKey: `app.canvas.nodeTypes.${GRAPH_NODE_TYPE_EXIT}`, descriptionKey: `nodeSearch.descriptions.${GRAPH_NODE_TYPE_EXIT}` },

  { type: GRAPH_NODE_TYPE_COMMENT, category: "other", icon: "note", displayNameKey: `app.canvas.nodeTypes.${GRAPH_NODE_TYPE_COMMENT}`, descriptionKey: `nodeSearch.descriptions.${GRAPH_NODE_TYPE_COMMENT}` },
  { type: GRAPH_NODE_TYPE_GROUP, category: "other", icon: "group", displayNameKey: `app.canvas.nodeTypes.${GRAPH_NODE_TYPE_GROUP}`, descriptionKey: `nodeSearch.descriptions.${GRAPH_NODE_TYPE_GROUP}` },
  { type: GRAPH_NODE_TYPE_STICKY_NOTE, category: "other", icon: "sticky-note", displayNameKey: `app.canvas.nodeTypes.${GRAPH_NODE_TYPE_STICKY_NOTE}`, descriptionKey: `nodeSearch.descriptions.${GRAPH_NODE_TYPE_STICKY_NOTE}` },
];

export function getAllNodeTypes(): readonly NodeTypeMeta[] {
  return NODE_CATALOG;
}

export const NODE_CATALOG_CATEGORY_ORDER: readonly NodeCatalogCategory[] = [
  "trigger",
  "action",
  "ai",
  "flow",
  "output",
  "other",
];

/** Apply a coarse pre-filter (Triggers / Actions / AI / All) to the catalog. */
export function filterNodeTypesByPreset(
  rows: readonly NodeTypeMeta[],
  preset: NodeCatalogFilter,
): readonly NodeTypeMeta[] {
  if (preset === "all") {
    return rows;
  }
  return rows.filter((row) => row.category === preset);
}

/**
 * Score a node row against a free-text query using a forgiving fuzzy match.
 * Returns null when there's no plausible match.
 * Lower score = better match. Used to drive ordering inside the popover.
 */
export function scoreNodeMatch(
  haystack: string,
  query: string,
): number | null {
  if (query === "") {
    return 0;
  }
  const h = haystack.toLowerCase();
  const q = query.toLowerCase();
  const directIdx = h.indexOf(q);
  if (directIdx !== -1) {
    return directIdx;
  }
  // Subsequence match — every query character appears in order somewhere.
  let hi = 0;
  let firstHit = -1;
  let gapSum = 0;
  let lastHit = -1;
  for (let qi = 0; qi < q.length; qi += 1) {
    const ch = q.charCodeAt(qi);
    let found = -1;
    while (hi < h.length) {
      if (h.charCodeAt(hi) === ch) {
        found = hi;
        hi += 1;
        break;
      }
      hi += 1;
    }
    if (found === -1) {
      return null;
    }
    if (firstHit === -1) {
      firstHit = found;
    }
    if (lastHit !== -1) {
      gapSum += found - lastHit - 1;
    }
    lastHit = found;
  }
  // Push subsequence results behind direct substring hits.
  return 1000 + firstHit + gapSum;
}
