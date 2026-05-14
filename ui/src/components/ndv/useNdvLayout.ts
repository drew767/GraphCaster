// Copyright GraphCaster. All Rights Reserved.

import { useCallback } from "react";

import { useNdvStore } from "./useNdvStore";

const MIN_SIDE_WIDTH = 280;
const DEFAULT_WIDTH = 320;

export interface NdvLayoutState {
  inputWidth: number;
  outputWidth: number;
  setInputWidth: (w: number) => void;
  setOutputWidth: (w: number) => void;
}

export function useNdvLayout(nodeType: string | null): NdvLayoutState {
  const panelWidths = useNdvStore((s) => s.panelWidths);
  const setPanelWidths = useNdvStore((s) => s.setPanelWidths);

  const widths = nodeType ? (panelWidths[nodeType] ?? null) : null;
  const inputWidth = widths?.input ?? DEFAULT_WIDTH;
  const outputWidth = widths?.output ?? DEFAULT_WIDTH;

  const setInputWidth = useCallback(
    (w: number) => {
      if (!nodeType) return;
      const clamped = Math.max(MIN_SIDE_WIDTH, w);
      const current = panelWidths[nodeType] ?? { input: DEFAULT_WIDTH, output: DEFAULT_WIDTH };
      setPanelWidths(nodeType, { ...current, input: clamped });
    },
    [nodeType, panelWidths, setPanelWidths],
  );

  const setOutputWidth = useCallback(
    (w: number) => {
      if (!nodeType) return;
      const clamped = Math.max(MIN_SIDE_WIDTH, w);
      const current = panelWidths[nodeType] ?? { input: DEFAULT_WIDTH, output: DEFAULT_WIDTH };
      setPanelWidths(nodeType, { ...current, output: clamped });
    },
    [nodeType, panelWidths, setPanelWidths],
  );

  return { inputWidth, outputWidth, setInputWidth, setOutputWidth };
}
