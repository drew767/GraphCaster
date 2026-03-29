// Copyright GraphCaster. All Rights Reserved.

import { createContext, useContext } from "react";

export type GcConnectionDragOrigin = { nodeId: string; handleId: string } | null;

export const GcConnectionDragContext = createContext<GcConnectionDragOrigin>(null);

export function useGcConnectionDrag(): GcConnectionDragOrigin {
  return useContext(GcConnectionDragContext);
}
