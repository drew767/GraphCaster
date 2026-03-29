// Copyright GraphCaster. All Rights Reserved.

import { createContext, useContext } from "react";

export type GcBranchEdgeUiContextValue = {
  showEdgeLabels: boolean;
  lodCompact: boolean;
};

const defaultBranchEdgeUi: GcBranchEdgeUiContextValue = {
  showEdgeLabels: true,
  lodCompact: false,
};

export const GcBranchEdgeUiContext = createContext<GcBranchEdgeUiContextValue>(defaultBranchEdgeUi);

export function useGcBranchEdgeUi(): GcBranchEdgeUiContextValue {
  return useContext(GcBranchEdgeUiContext);
}
