// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Edge, Node } from "@xyflow/react";

import { layeredLayoutPositions } from "../../../graph/layeredLayout";
import type {
  LayoutWorkerRequest,
  LayoutWorkerResponse,
} from "../../../workers/layoutWorker";

export interface LayoutOptions {
  direction?: "TB" | "LR" | "BT" | "RL";
  nodeSpacing?: number;
  rankSpacing?: number;
}

export interface UseAsyncLayoutResult {
  layoutedNodes: Node[];
  isLayouting: boolean;
  error: Error | null;
}

function layoutPreferWorker(): boolean {
  return (
    typeof Worker !== "undefined" &&
    import.meta.env.MODE !== "test" &&
    import.meta.env.VITE_GC_LAYOUT_WORKER !== "0"
  );
}

function mergePositions(nodes: Node[], positions: Record<string, { x: number; y: number }>): Node[] {
  return nodes.map((node) => ({
    ...node,
    position: positions[node.id] ?? node.position,
  }));
}

/**
 * Layered graph layout. Uses a Web Worker in the browser (not in Vitest) when enabled;
 * falls back to synchronous {@link layeredLayoutPositions} otherwise.
 */
export function useAsyncLayout(nodes: Node[], edges: Edge[], options: LayoutOptions = {}): UseAsyncLayoutResult {
  const inputHash = useMemo(
    () =>
      JSON.stringify({
        nodeIds: nodes.map((n) => n.id).sort(),
        edgeIds: edges.map((e) => e.id).sort(),
        options,
      }),
    [nodes, edges, options],
  );

  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const optionsRef = useRef(options);
  nodesRef.current = nodes;
  edgesRef.current = edges;
  optionsRef.current = options;

  const syncResult = useMemo(() => {
    try {
      const pos = layeredLayoutPositions(nodes, edges, options);
      const layoutedNodes = nodes.map((node) => ({
        ...node,
        position: pos.get(node.id) ?? node.position,
      }));
      return { layoutedNodes, error: null as Error | null };
    } catch (e) {
      return {
        layoutedNodes: nodes,
        error: e instanceof Error ? e : new Error(String(e)),
      };
    }
  }, [inputHash, nodes, edges]);

  const [workerState, setWorkerState] = useState<{
    layoutedNodes: Node[];
    isLayouting: boolean;
    error: Error | null;
  } | null>(null);

  const requestIdRef = useRef(0);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    if (!layoutPreferWorker()) {
      setWorkerState(null);
      return;
    }

    requestIdRef.current += 1;
    const reqId = requestIdRef.current;
    setWorkerState({
      layoutedNodes: nodesRef.current,
      isLayouting: true,
      error: null,
    });

    workerRef.current?.terminate();
    const worker = new Worker(new URL("../../../workers/layoutWorker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;

    const payload: LayoutWorkerRequest = {
      type: "layout",
      requestId: reqId,
      nodes: nodesRef.current.map((n) => ({
        id: n.id,
        position: n.position,
        width: n.width,
        height: n.height,
      })),
      edges: edgesRef.current.map((e) => ({ id: e.id, source: e.source, target: e.target })),
      options: optionsRef.current,
    };

    worker.postMessage(payload);

    worker.onmessage = (ev: MessageEvent<LayoutWorkerResponse>) => {
      const msg = ev.data;
      if (msg.type !== "layout-complete" || msg.requestId !== reqId) {
        return;
      }
      const merged = mergePositions(nodesRef.current, msg.positions);
      setWorkerState({
        layoutedNodes: merged,
        isLayouting: false,
        error: msg.error != null && msg.error !== "" ? new Error(msg.error) : null,
      });
    };

    worker.onerror = (err) => {
      setWorkerState({
        layoutedNodes: nodesRef.current,
        isLayouting: false,
        error: new Error(err.message || "layout worker error"),
      });
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [inputHash]);

  if (layoutPreferWorker()) {
    if (workerState == null) {
      return { layoutedNodes: nodes, isLayouting: true, error: null };
    }
    return {
      layoutedNodes: workerState.layoutedNodes,
      isLayouting: workerState.isLayouting,
      error: workerState.error,
    };
  }

  return {
    layoutedNodes: syncResult.layoutedNodes,
    isLayouting: false,
    error: syncResult.error,
  };
}
