// Copyright GraphCaster. All Rights Reserved.

import {
  allowedSourceHandles,
  allowedTargetHandles,
  isExecutableCommentOrDecorativeNodeType,
} from "./handleContract";
import { normalizeEdgeHandleValue, pickEdgeHandleRaw } from "./normalizeHandles";
import type { GraphDocumentJson, GraphNodeJson } from "./types";

export type HandleCompatibilityIssue =
  | {
      kind: "invalid_source_handle";
      edgeId: string;
      sourceId: string;
      sourceType: string;
      handle: string;
    }
  | {
      kind: "invalid_target_handle";
      edgeId: string;
      targetId: string;
      targetType: string;
      handle: string;
    };

function indexNodes(nodes: GraphNodeJson[] | undefined): Map<string, GraphNodeJson> {
  const m = new Map<string, GraphNodeJson>();
  for (const n of nodes ?? []) {
    m.set(n.id, n);
  }
  return m;
}

export function findHandleCompatibilityIssues(doc: GraphDocumentJson): HandleCompatibilityIssue[] {
  const byId = indexNodes(doc.nodes);
  const issues: HandleCompatibilityIssue[] = [];
  for (const e of doc.edges ?? []) {
    const src = byId.get(e.source);
    const tgt = byId.get(e.target);
    if (!src || !tgt) {
      continue;
    }
    if (isExecutableCommentOrDecorativeNodeType(src.type) || isExecutableCommentOrDecorativeNodeType(tgt.type)) {
      continue;
    }
    const er = e as unknown as Record<string, unknown>;
    const sh = normalizeEdgeHandleValue(pickEdgeHandleRaw(er, "sourceHandle", "source_handle"), "out_default");
    const th = normalizeEdgeHandleValue(pickEdgeHandleRaw(er, "targetHandle", "target_handle"), "in_default");
    const asrc = allowedSourceHandles(src.type);
    if (!asrc.has(sh)) {
      issues.push({
        kind: "invalid_source_handle",
        edgeId: e.id,
        sourceId: src.id,
        sourceType: src.type,
        handle: sh,
      });
    }
    const atgt = allowedTargetHandles(tgt.type);
    if (!atgt.has(th)) {
      issues.push({
        kind: "invalid_target_handle",
        edgeId: e.id,
        targetId: tgt.id,
        targetType: tgt.type,
        handle: th,
      });
    }
  }
  return issues;
}
