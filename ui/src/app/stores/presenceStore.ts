// Copyright GraphCaster. All Rights Reserved.

import { create } from "zustand";

export interface PresenceUser {
  name: string;
  color?: string;
}

export interface PresenceStore {
  byWorkflow: Record<string, PresenceUser[]>;
  setPresence: (workflowId: string, users: PresenceUser[]) => void;
  getPresence: (workflowId: string) => PresenceUser[];
  /** Read fallback presence from localStorage `gc.presence.<workflowId>`. */
  loadFromLocalStorage: (workflowId: string) => PresenceUser[];
}

const STORAGE_PREFIX = "gc.presence.";

function safeReadStorage(workflowId: string): PresenceUser[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(STORAGE_PREFIX + workflowId);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: PresenceUser[] = [];
    for (const item of parsed) {
      if (item && typeof item === "object") {
        const rec = item as Record<string, unknown>;
        if (typeof rec.name === "string") {
          out.push({
            name: rec.name,
            color: typeof rec.color === "string" ? rec.color : undefined,
          });
        }
      }
    }
    return out;
  } catch {
    return [];
  }
}

export const usePresenceStore = create<PresenceStore>((set, get) => ({
  byWorkflow: {},
  setPresence: (workflowId, users) => {
    set((state) => ({
      byWorkflow: { ...state.byWorkflow, [workflowId]: users },
    }));
  },
  getPresence: (workflowId) => get().byWorkflow[workflowId] ?? [],
  loadFromLocalStorage: (workflowId) => safeReadStorage(workflowId),
}));
