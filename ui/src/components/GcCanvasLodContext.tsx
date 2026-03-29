// Copyright GraphCaster. All Rights Reserved.

import { createContext, useContext, type ReactNode } from "react";

import type { GcCanvasLodLevel } from "../graph/canvasLod";

const Ctx = createContext<GcCanvasLodLevel | null>(null);

/** Wrap `<ReactFlow>` so custom `nodeTypes` can call {@link useGcCanvasLod}. */
export function GcCanvasLodProvider(props: { value: GcCanvasLodLevel; children: ReactNode }) {
  return <Ctx.Provider value={props.value}>{props.children}</Ctx.Provider>;
}

export function useGcCanvasLod(): GcCanvasLodLevel {
  const v = useContext(Ctx);
  if (v === null) {
    if (import.meta.env.DEV) {
      console.warn("useGcCanvasLod() outside GcCanvasLodProvider — using full LOD");
    }
    return "full";
  }
  return v;
}
