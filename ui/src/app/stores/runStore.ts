// Copyright GraphCaster. All Rights Reserved.

import { create } from "zustand";

export interface StartRunOptions {
  useFreshData?: boolean;
  usePinnedData?: boolean;
}

export interface RunRecord {
  id: string;
  workflowId: string;
  options: StartRunOptions;
  startedAt: number;
}

export type NodeRunStatus = "running" | "success" | "error";

export interface RunStore {
  runs: RunRecord[];
  statusByNode: Record<string, NodeRunStatus>;
  startRun: (workflowId: string, options?: StartRunOptions) => RunRecord;
  setNodeStatus: (nodeId: string, status: NodeRunStatus) => void;
  clearNodeStatuses: () => void;
}

let counter = 0;

export const useRunStore = create<RunStore>((set) => ({
  runs: [],
  statusByNode: {},
  startRun: (workflowId, options = {}) => {
    const record: RunRecord = {
      id: `run-${Date.now()}-${++counter}`,
      workflowId,
      options,
      startedAt: Date.now(),
    };
    set((state) => ({ runs: [...state.runs, record] }));
    return record;
  },
  setNodeStatus: (nodeId, status) => {
    if (!nodeId) return;
    set((state) => {
      const prev = state.statusByNode[nodeId];
      if (prev === status) return state;
      return {
        statusByNode: { ...state.statusByNode, [nodeId]: status },
      };
    });
  },
  clearNodeStatuses: () => {
    set({ statusByNode: {} });
  },
}));
