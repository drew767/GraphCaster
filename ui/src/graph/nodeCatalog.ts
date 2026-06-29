// Copyright GraphCaster. All Rights Reserved.

/**
 * UX-facing palette catalog for the node search popover / picker.
 *
 * The **list of types** comes from the SSOT `schemas/node-types.json` via
 * `nodeTypesCatalog.ts`. This file overlays only UI-specific UX metadata
 * (palette category, icon) and a deterministic i18n-key formula. Drift in
 * the type list is impossible by construction; drift in UX metadata is
 * UI-local.
 */

import { getAllNodeTypeInfos } from "./nodeTypesCatalog";

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

/** UX overlay: per-type palette category + icon. UI-local, not part of SSOT. */
const UX_META: Record<string, { category: NodeCatalogCategory; icon?: string }> = {
  start: { category: "trigger", icon: "play" },
  trigger_webhook: { category: "trigger", icon: "webhook" },
  trigger_schedule: { category: "trigger", icon: "clock" },

  task: { category: "action", icon: "square" },
  http_request: { category: "action", icon: "globe" },
  mcp_tool: { category: "action", icon: "tool" },
  python_code: { category: "action", icon: "code" },
  set_variable: { category: "action", icon: "variable" },
  delay: { category: "action", icon: "timer" },
  debounce: { category: "action", icon: "timer" },
  wait_for: { category: "action", icon: "hourglass" },

  ai_route: { category: "ai", icon: "brain" },
  llm_agent: { category: "ai", icon: "robot" },
  agent: { category: "ai", icon: "robot" },
  rag_query: { category: "ai", icon: "search" },
  rag_index: { category: "ai", icon: "database" },

  fork: { category: "flow", icon: "split" },
  merge: { category: "flow", icon: "merge" },
  graph_ref: { category: "flow", icon: "link" },

  exit: { category: "output", icon: "stop" },

  comment: { category: "other", icon: "note" },
  group: { category: "other", icon: "group" },
  sticky_note: { category: "other", icon: "sticky-note" },
};

/** Default UX bucket for any SSOT type that hasn't been classified yet. */
const DEFAULT_UX_META = { category: "other" as NodeCatalogCategory };

function buildCatalog(): readonly NodeTypeMeta[] {
  return getAllNodeTypeInfos()
    .filter((info) => info.implementedIn.includes("ui"))
    .map((info) => {
      const ux = UX_META[info.type] ?? DEFAULT_UX_META;
      return {
        type: info.type,
        displayNameKey: `app.canvas.nodeTypes.${info.type}`,
        descriptionKey: `nodeSearch.descriptions.${info.type}`,
        category: ux.category,
        icon: ux.icon,
      };
    });
}

const NODE_CATALOG: readonly NodeTypeMeta[] = buildCatalog();

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
