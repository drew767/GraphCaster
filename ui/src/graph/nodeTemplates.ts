// Copyright GraphCaster. All Rights Reserved.

import type { GraphCasterClipboardV1 } from "./clipboard";
import { GRAPH_CASTER_CLIPBOARD_KIND } from "./clipboard";
import {
  GRAPH_NODE_TYPE_DELAY,
  GRAPH_NODE_TYPE_HTTP_REQUEST,
  GRAPH_NODE_TYPE_RAG_QUERY,
  GRAPH_NODE_TYPE_TASK,
} from "./nodeKinds";
import { defaultDataForNodeType } from "./nodePalette";

/** Placeholder ids — remapped by `mergePastedSubgraph`. */
const A = "__gc_tpl_a";
const B = "__gc_tpl_b";

export const NODE_TEMPLATE_IDS = ["tpl_http_task", "tpl_rag_task", "tpl_delay_task"] as const;

export type NodeTemplateId = (typeof NODE_TEMPLATE_IDS)[number];

export type BuiltInNodeTemplate = {
  id: NodeTemplateId;
  titleKey: string;
  anchor: { x: number; y: number };
  payload: GraphCasterClipboardV1;
};

function edge(from: string, to: string): GraphCasterClipboardV1["edges"][number] {
  return {
    id: "__gc_tpl_e",
    source: from,
    target: to,
    sourceHandle: "out_default",
    targetHandle: "in_default",
    condition: null,
  };
}

const httpTask: BuiltInNodeTemplate = {
  id: "tpl_http_task",
  titleKey: "app.canvas.nodeTemplates.tpl_http_task",
  anchor: { x: 0, y: 0 },
  payload: {
    kind: GRAPH_CASTER_CLIPBOARD_KIND,
    schemaVersion: 1,
    nodes: [
      {
        id: A,
        type: GRAPH_NODE_TYPE_HTTP_REQUEST,
        position: { x: 0, y: 0 },
        data: { ...defaultDataForNodeType(GRAPH_NODE_TYPE_HTTP_REQUEST) },
      },
      {
        id: B,
        type: GRAPH_NODE_TYPE_TASK,
        position: { x: 340, y: 0 },
        data: { ...defaultDataForNodeType(GRAPH_NODE_TYPE_TASK), title: "Next step" },
      },
    ],
    edges: [edge(A, B)],
  },
};

const ragTask: BuiltInNodeTemplate = {
  id: "tpl_rag_task",
  titleKey: "app.canvas.nodeTemplates.tpl_rag_task",
  anchor: { x: 0, y: 0 },
  payload: {
    kind: GRAPH_CASTER_CLIPBOARD_KIND,
    schemaVersion: 1,
    nodes: [
      {
        id: A,
        type: GRAPH_NODE_TYPE_RAG_QUERY,
        position: { x: 0, y: 0 },
        data: { ...defaultDataForNodeType(GRAPH_NODE_TYPE_RAG_QUERY) },
      },
      {
        id: B,
        type: GRAPH_NODE_TYPE_TASK,
        position: { x: 360, y: 0 },
        data: { ...defaultDataForNodeType(GRAPH_NODE_TYPE_TASK), title: "Use context" },
      },
    ],
    edges: [edge(A, B)],
  },
};

const delayTask: BuiltInNodeTemplate = {
  id: "tpl_delay_task",
  titleKey: "app.canvas.nodeTemplates.tpl_delay_task",
  anchor: { x: 0, y: 0 },
  payload: {
    kind: GRAPH_CASTER_CLIPBOARD_KIND,
    schemaVersion: 1,
    nodes: [
      {
        id: A,
        type: GRAPH_NODE_TYPE_DELAY,
        position: { x: 0, y: 0 },
        data: { ...defaultDataForNodeType(GRAPH_NODE_TYPE_DELAY), durationSec: 1 },
      },
      {
        id: B,
        type: GRAPH_NODE_TYPE_TASK,
        position: { x: 300, y: 0 },
        data: { ...defaultDataForNodeType(GRAPH_NODE_TYPE_TASK), title: "After delay" },
      },
    ],
    edges: [edge(A, B)],
  },
};

const BY_ID: ReadonlyMap<NodeTemplateId, BuiltInNodeTemplate> = new Map([
  [httpTask.id, httpTask],
  [ragTask.id, ragTask],
  [delayTask.id, delayTask],
]);

export const BUILT_IN_NODE_TEMPLATES: readonly BuiltInNodeTemplate[] = [httpTask, ragTask, delayTask];

export function builtInNodeTemplateById(id: string): BuiltInNodeTemplate | null {
  const k = id.trim() as NodeTemplateId;
  return BY_ID.get(k) ?? null;
}

export function filterNodeTemplateIds(params: {
  category: string;
  filterText: string;
  labelForTemplate: (id: NodeTemplateId) => string;
  connectFilter?: unknown | null;
}): NodeTemplateId[] {
  if (params.connectFilter) {
    return [];
  }
  if (params.category !== "all" && params.category !== "templates") {
    return [];
  }
  const q = params.filterText.trim().toLowerCase();
  const base = [...NODE_TEMPLATE_IDS];
  if (q === "") {
    return base;
  }
  return base.filter((id) => {
    const label = params.labelForTemplate(id).toLowerCase();
    return id.toLowerCase().includes(q) || label.includes(q);
  });
}
