// Copyright GraphCaster. All Rights Reserved.

import * as Y from "yjs";

import type { GraphEdgeJson, GraphNodeJson } from "../graph/types";
import type { CollabProvider } from "./yjs_provider";

export interface GraphStoreSnapshot {
  nodes: GraphNodeJson[];
  edges: GraphEdgeJson[];
}

export interface GraphStoreBridge {
  getSnapshot(): GraphStoreSnapshot;
  applyRemote(snapshot: GraphStoreSnapshot): void;
}

let _applying = false;

export function bindCollabToStore(
  provider: CollabProvider,
  bridge: GraphStoreBridge,
): (snapshot: GraphStoreSnapshot) => void {
  const yNodes = provider.doc.getMap<Record<string, unknown>>("nodes");
  const yEdges = provider.doc.getMap<Record<string, unknown>>("edges");

  function yToStore(): void {
    if (_applying) return;
    _applying = true;
    try {
      const nodes: GraphNodeJson[] = [];
      yNodes.forEach((val, _key) => {
        nodes.push(val as unknown as GraphNodeJson);
      });
      const edges: GraphEdgeJson[] = [];
      yEdges.forEach((val, _key) => {
        edges.push(val as unknown as GraphEdgeJson);
      });
      bridge.applyRemote({ nodes, edges });
    } finally {
      _applying = false;
    }
  }

  function storeToY(snapshot: GraphStoreSnapshot): void {
    if (_applying) return;
    provider.doc.transact(() => {
      const newNodeIds = new Set(snapshot.nodes.map((n) => n.id));
      const newEdgeIds = new Set(snapshot.edges.map((e) => e.id));

      for (const id of Array.from(yNodes.keys())) {
        if (!newNodeIds.has(id)) yNodes.delete(id);
      }
      for (const node of snapshot.nodes) {
        yNodes.set(node.id, node as unknown as Record<string, unknown>);
      }

      for (const id of Array.from(yEdges.keys())) {
        if (!newEdgeIds.has(id)) yEdges.delete(id);
      }
      for (const edge of snapshot.edges) {
        yEdges.set(edge.id, edge as unknown as Record<string, unknown>);
      }
    }, "local");
  }

  yNodes.observe(() => yToStore());
  yEdges.observe(() => yToStore());

  return storeToY;
}
