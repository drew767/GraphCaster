// Copyright GraphCaster. All Rights Reserved.

import { create } from "zustand";

export interface AutosaveEntry {
  saving: boolean;
  lastSaved: number | null;
  error: Error | null;
}

export interface AutosaveStore {
  byWorkflow: Record<string, AutosaveEntry>;
  /** Registered retry callback per workflow id, injected by `useSaveWorkflow`. */
  retryHandlers: Record<string, () => Promise<void> | void>;
  markSaving: (workflowId: string) => void;
  markSaved: (workflowId: string, at: number) => void;
  markError: (workflowId: string, error: Error) => void;
  registerRetry: (workflowId: string, handler: () => Promise<void> | void) => void;
  unregisterRetry: (workflowId: string) => void;
  retry: (workflowId: string) => Promise<void>;
}

const EMPTY_ENTRY: AutosaveEntry = {
  saving: false,
  lastSaved: null,
  error: null,
};

export const useAutosaveStore = create<AutosaveStore>((set, get) => ({
  byWorkflow: {},
  retryHandlers: {},

  markSaving: (workflowId) => {
    set((state) => {
      const prev = state.byWorkflow[workflowId] ?? EMPTY_ENTRY;
      return {
        byWorkflow: {
          ...state.byWorkflow,
          [workflowId]: { ...prev, saving: true, error: null },
        },
      };
    });
  },

  markSaved: (workflowId, at) => {
    set((state) => {
      const prev = state.byWorkflow[workflowId] ?? EMPTY_ENTRY;
      return {
        byWorkflow: {
          ...state.byWorkflow,
          [workflowId]: { ...prev, saving: false, error: null, lastSaved: at },
        },
      };
    });
  },

  markError: (workflowId, error) => {
    set((state) => {
      const prev = state.byWorkflow[workflowId] ?? EMPTY_ENTRY;
      return {
        byWorkflow: {
          ...state.byWorkflow,
          [workflowId]: { ...prev, saving: false, error },
        },
      };
    });
  },

  registerRetry: (workflowId, handler) => {
    set((state) => ({
      retryHandlers: { ...state.retryHandlers, [workflowId]: handler },
    }));
  },

  unregisterRetry: (workflowId) => {
    set((state) => {
      if (!(workflowId in state.retryHandlers)) return state;
      const next = { ...state.retryHandlers };
      delete next[workflowId];
      return { retryHandlers: next };
    });
  },

  retry: async (workflowId) => {
    const h = get().retryHandlers[workflowId];
    if (!h) return;
    await h();
  },
}));
