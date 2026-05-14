// Copyright GraphCaster. All Rights Reserved.

import type { Edge, Node } from "@xyflow/react";

import type { GcNodeData } from "../toReactFlow";

export interface SplitEdgeIds {
  /** Newly created node id. */
  newNodeId: string;
  /** Edge id for `source → newNode`. */
  edgeInId: string;
  /** Edge id for `newNode → target`. */
  edgeOutId: string;
}

export interface SplitEdgeResult {
  nodes: Node[];
  edges: Edge[];
  /** `null` when `edgeId` was not found. */
  ids: SplitEdgeIds | null;
}

export interface SplitEdgeOptions {
  edgeId: string;
  nodeType: string;
  position: { x: number; y: number };
  newNodeId: string;
  newEdgeInId: string;
  newEdgeOutId: string;
  /** Defaults to `"gcNode"`. */
  nodeReactFlowType?: string;
  /** Defaults to `"out_default"` / `"in_default"`. */
  defaultSourceHandle?: string;
  defaultTargetHandle?: string;
}

/**
 * Pure split: removes `edgeId`, inserts a new node at `position`, wires
 * `source → new → target`, preserving the original edge's React-Flow `type`.
 * Returns the updated arrays and the ids that were generated.
 */
export function splitEdgeWithNode(
  nodes: readonly Node[],
  edges: readonly Edge[],
  options: SplitEdgeOptions,
): SplitEdgeResult {
  const {
    edgeId,
    nodeType,
    position,
    newNodeId,
    newEdgeInId,
    newEdgeOutId,
    nodeReactFlowType = "gcNode",
    defaultSourceHandle = "out_default",
    defaultTargetHandle = "in_default",
  } = options;

  const target = edges.find((e) => e.id === edgeId);
  if (!target) {
    return { nodes: [...nodes], edges: [...edges], ids: null };
  }

  const newNode: Node<GcNodeData> = {
    id: newNodeId,
    type: nodeReactFlowType,
    position: { x: position.x, y: position.y },
    data: {
      graphNodeType: nodeType,
      label: newNodeId,
      raw: {},
    },
  };
  const remaining = edges.filter((e) => e.id !== edgeId);
  const edgeIn: Edge = {
    id: newEdgeInId,
    type: target.type,
    source: target.source,
    target: newNodeId,
    sourceHandle: target.sourceHandle ?? defaultSourceHandle,
    targetHandle: defaultTargetHandle,
  };
  const edgeOut: Edge = {
    id: newEdgeOutId,
    type: target.type,
    source: newNodeId,
    target: target.target,
    sourceHandle: defaultSourceHandle,
    targetHandle: target.targetHandle ?? defaultTargetHandle,
  };
  return {
    nodes: [...nodes, newNode],
    edges: [...remaining, edgeIn, edgeOut],
    ids: { newNodeId, edgeInId: newEdgeInId, edgeOutId: newEdgeOutId },
  };
}
