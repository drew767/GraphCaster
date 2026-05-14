// Copyright GraphCaster. All Rights Reserved.

import { create } from "zustand";

export interface WorkflowEntity {
  id: string;
  name: string;
  active: boolean;
  tags: string[];
}

export interface WorkflowStore {
  workflows: Record<string, WorkflowEntity>;
  ensureWorkflow: (id: string, defaults?: Partial<Omit<WorkflowEntity, "id">>) => WorkflowEntity;
  getWorkflow: (id: string) => WorkflowEntity | undefined;
  renameWorkflow: (id: string, name: string) => void;
  setActive: (id: string, value: boolean) => void;
  setTags: (id: string, tags: string[]) => void;
}

const DEFAULT_WORKFLOW: Omit<WorkflowEntity, "id"> = {
  name: "",
  active: false,
  tags: [],
};

export const useWorkflowStore = create<WorkflowStore>((set, get) => ({
  workflows: {},

  ensureWorkflow: (id, defaults) => {
    const existing = get().workflows[id];
    if (existing) return existing;
    const created: WorkflowEntity = {
      id,
      ...DEFAULT_WORKFLOW,
      ...defaults,
    };
    set((state) => ({ workflows: { ...state.workflows, [id]: created } }));
    return created;
  },

  getWorkflow: (id) => get().workflows[id],

  renameWorkflow: (id, name) => {
    set((state) => {
      const wf = state.workflows[id] ?? { id, ...DEFAULT_WORKFLOW };
      return {
        workflows: { ...state.workflows, [id]: { ...wf, name } },
      };
    });
  },

  setActive: (id, value) => {
    set((state) => {
      const wf = state.workflows[id] ?? { id, ...DEFAULT_WORKFLOW };
      return {
        workflows: { ...state.workflows, [id]: { ...wf, active: value } },
      };
    });
  },

  setTags: (id, tags) => {
    set((state) => {
      const wf = state.workflows[id] ?? { id, ...DEFAULT_WORKFLOW };
      return {
        workflows: { ...state.workflows, [id]: { ...wf, tags } },
      };
    });
  },
}));
