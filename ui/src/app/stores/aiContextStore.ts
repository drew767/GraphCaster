// Copyright GraphCaster. All Rights Reserved.

import { create } from "zustand";

export type AiContextKind = "workflow" | "node" | "none";

export interface AiContext {
  kind: AiContextKind;
  label: string;
}

interface AiContextState {
  context: AiContext;
  setWorkflowContext: (name: string) => void;
  setNodeContext: (type: string) => void;
  clearContext: () => void;
}

const DEFAULT_CONTEXT: AiContext = { kind: "none", label: "" };

export const useAiContextStore = create<AiContextState>((set) => ({
  context: DEFAULT_CONTEXT,
  setWorkflowContext: (name) =>
    set({ context: { kind: "workflow", label: name } }),
  setNodeContext: (type) =>
    set({ context: { kind: "node", label: type } }),
  clearContext: () => set({ context: DEFAULT_CONTEXT }),
}));
