// Copyright GraphCaster. All Rights Reserved.

/**
 * Live connection validation (F18) — aligns with editor connect rules and the handle / `PortDataKind`
 * matrix used in `findHandleCompatibilityIssues` for a **new** edge (registry kinds only; no edge `data`
 * overrides until the edge exists). Note: static validation **skips** comment/group endpoints on saved
 * edges, while live connect **blocks** wiring to frame nodes (`gcComment` / `gcGroup`), matching prior `onConnect`.
 */

import type { Connection, Edge, Node } from "@xyflow/react";

import { allowedSourceHandles, allowedTargetHandles } from "./handleContract";
import { classifyPortKindPair } from "./portDataKindCompat";
import * as portKinds from "./portDataKinds";
import { flowConnectionHandle } from "./normalizeHandles";
import type { GcNodeData } from "./toReactFlow";
import { isReactFlowFrameNodeType } from "./nodeKinds";

function graphTypeOf(node: Node<GcNodeData> | undefined): string {
  const d = node?.data as GcNodeData | undefined;
  return d?.graphNodeType ?? "unknown";
}

/**
 * Returns whether a hypothetical new edge would violate handle contract or hard port-kind block
 * (warn-level json↔primitive remains allowed — yellow edge after save, parity with Python).
 */
export function isRegistryConnectionStructurallyFine(
  sourceGraphType: string,
  targetGraphType: string,
  sourceHandleNorm: string,
  targetHandleNorm: string,
): boolean {
  if (!allowedSourceHandles(sourceGraphType).has(sourceHandleNorm)) {
    return false;
  }
  if (!allowedTargetHandles(targetGraphType).has(targetHandleNorm)) {
    return false;
  }
  const outK = portKinds.portDataKindForSource(sourceGraphType, sourceHandleNorm);
  const inK = portKinds.portDataKindForTarget(targetGraphType, targetHandleNorm);
  return classifyPortKindPair(outK, inK) !== "block";
}

export type GcConnectionLike = Pick<Connection, "source" | "target"> & {
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

export function isGcFlowConnectionAllowed(
  connection: GcConnectionLike,
  flowNodes: readonly Node<GcNodeData>[],
  flowEdges: readonly Edge[],
): boolean {
  const source = connection.source;
  const target = connection.target;
  if (!source || !target || source === target) {
    return false;
  }
  const byId = new Map(flowNodes.map((n) => [n.id, n]));
  const srcNode = byId.get(source);
  const tgtNode = byId.get(target);
  if (!srcNode || !tgtNode) {
    return false;
  }
  if (isReactFlowFrameNodeType(srcNode.type) || isReactFlowFrameNodeType(tgtNode.type)) {
    return false;
  }
  const sh = flowConnectionHandle(connection.sourceHandle, "out_default");
  const th = flowConnectionHandle(connection.targetHandle, "in_default");
  const srcType = graphTypeOf(srcNode);
  const tgtType = graphTypeOf(tgtNode);
  if (!isRegistryConnectionStructurallyFine(srcType, tgtType, sh, th)) {
    return false;
  }
  const dup = flowEdges.some(
    (e) =>
      e.source === source &&
      e.target === target &&
      flowConnectionHandle(e.sourceHandle, "out_default") === sh &&
      flowConnectionHandle(e.targetHandle, "in_default") === th,
  );
  return !dup;
}
