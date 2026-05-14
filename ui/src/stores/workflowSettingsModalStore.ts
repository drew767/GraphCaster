// Copyright GraphCaster. All Rights Reserved.

import { create } from "zustand";

interface WorkflowSettingsModalState {
  open: boolean;
  workflowId: string | null;
  openFor: (workflowId: string) => void;
  close: () => void;
}

export const useWorkflowSettingsModalStore = create<WorkflowSettingsModalState>((set) => ({
  open: false,
  workflowId: null,
  openFor: (workflowId) => set({ open: true, workflowId }),
  close: () => set({ open: false, workflowId: null }),
}));
