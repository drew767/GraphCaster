// Copyright GraphCaster. All Rights Reserved.

import { create } from "zustand";

const LS_KEY_PREFIX = "gc-ndv-widths-";
const LS_VIEW_INPUT = "gc-ndv-input-view";
const LS_VIEW_OUTPUT = "gc-ndv-output-view";
const LS_FIELD_MODE = "gc.ndv.fieldMode";

export type FieldMode = "fixed" | "expression";

export type NdvViewMode = "schema" | "table" | "json" | "binary";

export interface NdvPanelWidths {
  input: number;
  output: number;
}

const DEFAULT_WIDTHS: NdvPanelWidths = {
  input: 320,
  output: 320,
};

const DEFAULT_INPUT_VIEW: NdvViewMode = "schema";
const DEFAULT_OUTPUT_VIEW: NdvViewMode = "schema";

function readWidths(nodeType: string): NdvPanelWidths {
  try {
    const raw = localStorage.getItem(`${LS_KEY_PREFIX}${nodeType}`);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<NdvPanelWidths>;
      return {
        input: parsed.input ?? DEFAULT_WIDTHS.input,
        output: parsed.output ?? DEFAULT_WIDTHS.output,
      };
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_WIDTHS };
}

function persistWidths(nodeType: string, widths: NdvPanelWidths): void {
  try {
    localStorage.setItem(`${LS_KEY_PREFIX}${nodeType}`, JSON.stringify(widths));
  } catch {
    // ignore
  }
}

function readViewMap(key: string): Record<string, NdvViewMode> {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, NdvViewMode>;
      if (parsed && typeof parsed === "object") return parsed;
    }
  } catch {
    // ignore
  }
  return {};
}

function persistViewMap(key: string, map: Record<string, NdvViewMode>): void {
  try {
    localStorage.setItem(key, JSON.stringify(map));
  } catch {
    // ignore
  }
}

function readFieldMode(): Record<string, FieldMode> {
  try {
    const raw = localStorage.getItem(LS_FIELD_MODE);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, FieldMode>;
      if (parsed && typeof parsed === "object") return parsed;
    }
  } catch {
    // ignore
  }
  return {};
}

function persistFieldMode(map: Record<string, FieldMode>): void {
  try {
    localStorage.setItem(LS_FIELD_MODE, JSON.stringify(map));
  } catch {
    // ignore
  }
}

export interface NdvState {
  activeNodeId: string | null;
  activeNodeType: string | null;
  panelWidths: Record<string, NdvPanelWidths>;
  inputView: Record<string, NdvViewMode>;
  outputView: Record<string, NdvViewMode>;
  itemIndex: Record<string, { input: number; output: number }>;
  fieldMode: Record<string, FieldMode>;
  openNdv: (nodeId: string, nodeType: string) => void;
  closeNdv: () => void;
  setPanelWidths: (nodeType: string, widths: NdvPanelWidths) => void;
  setInputView: (nodeId: string, view: NdvViewMode) => void;
  setOutputView: (nodeId: string, view: NdvViewMode) => void;
  setItemIndex: (nodeId: string, panel: "input" | "output", index: number) => void;
  setFieldMode: (paramKey: string, mode: FieldMode) => void;
}

export const useNdvStore = create<NdvState>((set, get) => ({
  activeNodeId: null,
  activeNodeType: null,
  panelWidths: {},
  inputView: typeof localStorage !== "undefined" ? readViewMap(LS_VIEW_INPUT) : {},
  outputView: typeof localStorage !== "undefined" ? readViewMap(LS_VIEW_OUTPUT) : {},
  itemIndex: {},
  fieldMode: typeof localStorage !== "undefined" ? readFieldMode() : {},

  openNdv: (nodeId: string, nodeType: string) => {
    const existing = get().panelWidths[nodeType];
    if (!existing) {
      const loaded = readWidths(nodeType);
      set((s) => ({
        activeNodeId: nodeId,
        activeNodeType: nodeType,
        panelWidths: { ...s.panelWidths, [nodeType]: loaded },
      }));
    } else {
      set({ activeNodeId: nodeId, activeNodeType: nodeType });
    }
  },

  closeNdv: () => {
    set({ activeNodeId: null, activeNodeType: null });
  },

  setPanelWidths: (nodeType: string, widths: NdvPanelWidths) => {
    persistWidths(nodeType, widths);
    set((s) => ({
      panelWidths: { ...s.panelWidths, [nodeType]: widths },
    }));
  },

  setInputView: (nodeId: string, view: NdvViewMode) => {
    set((s) => {
      const next = { ...s.inputView, [nodeId]: view };
      persistViewMap(LS_VIEW_INPUT, next);
      return { inputView: next };
    });
  },

  setOutputView: (nodeId: string, view: NdvViewMode) => {
    set((s) => {
      const next = { ...s.outputView, [nodeId]: view };
      persistViewMap(LS_VIEW_OUTPUT, next);
      return { outputView: next };
    });
  },

  setItemIndex: (nodeId: string, panel: "input" | "output", index: number) => {
    set((s) => {
      const current = s.itemIndex[nodeId] ?? { input: 0, output: 0 };
      return {
        itemIndex: {
          ...s.itemIndex,
          [nodeId]: { ...current, [panel]: index },
        },
      };
    });
  },

  setFieldMode: (paramKey: string, mode: FieldMode) => {
    set((s) => {
      const next = { ...s.fieldMode, [paramKey]: mode };
      persistFieldMode(next);
      return { fieldMode: next };
    });
  },
}));

export const NDV_DEFAULT_INPUT_VIEW = DEFAULT_INPUT_VIEW;
export const NDV_DEFAULT_OUTPUT_VIEW = DEFAULT_OUTPUT_VIEW;
