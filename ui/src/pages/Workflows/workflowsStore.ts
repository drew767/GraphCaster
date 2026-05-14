// Copyright GraphCaster. All Rights Reserved.

import { create } from "zustand";
import type { Folder, Project, Workflow, WorkflowStatus } from "./types";

const FOLDERS_KEY = "gc.folders";
const WORKFLOWS_KEY = "gc.workflows";
const PROJECTS_KEY = "gc.projects";
const TAGS_KEY = "gc.tags";

function readLs<T>(key: string, fallback: T): T {
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeLs(key: string, value: unknown): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota errors
  }
}

export interface WorkflowsState {
  workflows: Workflow[];
  folders: Folder[];
  projects: Project[];
  tags: string[];
  hydrate: (seed?: Partial<Pick<WorkflowsState, "workflows" | "folders" | "projects" | "tags">>) => void;
  addFolder: (name: string, parentId?: string | null) => Folder;
  renameFolder: (id: string, name: string) => void;
  deleteFolder: (id: string) => void;
  setWorkflowStatus: (id: string, status: WorkflowStatus) => void;
  archiveWorkflow: (id: string) => void;
  unarchiveWorkflow: (id: string) => void;
  deleteWorkflow: (id: string) => void;
  duplicateWorkflow: (id: string, newName: string) => Workflow | null;
  moveWorkflow: (id: string, folderId: string | null) => void;
  setWorkflowTags: (id: string, tags: string[]) => void;
  addTag: (name: string) => void;
  renameTag: (oldName: string, newName: string) => void;
  deleteTag: (name: string) => void;
  bulkDelete: (ids: string[]) => void;
  bulkArchive: (ids: string[]) => void;
  bulkSetStatus: (ids: string[], status: WorkflowStatus) => void;
  bulkMove: (ids: string[], folderId: string | null) => void;
  bulkTag: (ids: string[], tag: string) => void;
}

export const useWorkflowsStore = create<WorkflowsState>((set, get) => ({
  workflows: readLs<Workflow[]>(WORKFLOWS_KEY, []),
  folders: readLs<Folder[]>(FOLDERS_KEY, []),
  projects: readLs<Project[]>(PROJECTS_KEY, []),
  tags: readLs<string[]>(TAGS_KEY, []),

  hydrate: (seed) => {
    set((s) => {
      const next: WorkflowsState = {
        ...s,
        workflows: seed?.workflows ?? s.workflows,
        folders: seed?.folders ?? s.folders,
        projects: seed?.projects ?? s.projects,
        tags: seed?.tags ?? s.tags,
      };
      writeLs(WORKFLOWS_KEY, next.workflows);
      writeLs(FOLDERS_KEY, next.folders);
      writeLs(PROJECTS_KEY, next.projects);
      writeLs(TAGS_KEY, next.tags);
      return next;
    });
  },

  addFolder: (name, parentId = null) => {
    const folder: Folder = {
      id: `f_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name,
      parentId,
    };
    set((s) => {
      const folders = [...s.folders, folder];
      writeLs(FOLDERS_KEY, folders);
      return { folders };
    });
    return folder;
  },

  renameFolder: (id, name) => {
    set((s) => {
      const folders = s.folders.map((f) => (f.id === id ? { ...f, name } : f));
      writeLs(FOLDERS_KEY, folders);
      return { folders };
    });
  },

  deleteFolder: (id) => {
    set((s) => {
      const folders = s.folders.filter((f) => f.id !== id);
      const workflows = s.workflows.map((w) =>
        w.folderId === id ? { ...w, folderId: null } : w,
      );
      writeLs(FOLDERS_KEY, folders);
      writeLs(WORKFLOWS_KEY, workflows);
      return { folders, workflows };
    });
  },

  setWorkflowStatus: (id, status) => {
    set((s) => {
      const workflows = s.workflows.map((w) =>
        w.id === id ? { ...w, status, updatedAt: Date.now() } : w,
      );
      writeLs(WORKFLOWS_KEY, workflows);
      return { workflows };
    });
  },

  archiveWorkflow: (id) => get().setWorkflowStatus(id, "archived"),
  unarchiveWorkflow: (id) => get().setWorkflowStatus(id, "inactive"),

  deleteWorkflow: (id) => {
    set((s) => {
      const workflows = s.workflows.filter((w) => w.id !== id);
      writeLs(WORKFLOWS_KEY, workflows);
      return { workflows };
    });
  },

  duplicateWorkflow: (id, newName) => {
    const src = get().workflows.find((w) => w.id === id);
    if (!src) return null;
    const now = Date.now();
    const copy: Workflow = {
      ...src,
      id: `w_${now}_${Math.random().toString(36).slice(2, 7)}`,
      name: newName,
      createdAt: now,
      updatedAt: now,
      status: "inactive",
    };
    set((s) => {
      const workflows = [...s.workflows, copy];
      writeLs(WORKFLOWS_KEY, workflows);
      return { workflows };
    });
    return copy;
  },

  moveWorkflow: (id, folderId) => {
    set((s) => {
      const workflows = s.workflows.map((w) =>
        w.id === id ? { ...w, folderId, updatedAt: Date.now() } : w,
      );
      writeLs(WORKFLOWS_KEY, workflows);
      return { workflows };
    });
  },

  setWorkflowTags: (id, tags) => {
    set((s) => {
      const workflows = s.workflows.map((w) =>
        w.id === id ? { ...w, tags, updatedAt: Date.now() } : w,
      );
      const mergedTags = Array.from(new Set([...s.tags, ...tags]));
      writeLs(WORKFLOWS_KEY, workflows);
      writeLs(TAGS_KEY, mergedTags);
      return { workflows, tags: mergedTags };
    });
  },

  addTag: (name) => {
    set((s) => {
      if (!name.trim() || s.tags.includes(name)) return s;
      const tags = [...s.tags, name];
      writeLs(TAGS_KEY, tags);
      return { tags };
    });
  },

  renameTag: (oldName, newName) => {
    set((s) => {
      if (!newName.trim() || oldName === newName) return s;
      const tags = s.tags.map((t) => (t === oldName ? newName : t));
      const workflows = s.workflows.map((w) => ({
        ...w,
        tags: w.tags.map((t) => (t === oldName ? newName : t)),
      }));
      writeLs(TAGS_KEY, tags);
      writeLs(WORKFLOWS_KEY, workflows);
      return { tags, workflows };
    });
  },

  deleteTag: (name) => {
    set((s) => {
      const tags = s.tags.filter((t) => t !== name);
      const workflows = s.workflows.map((w) => ({
        ...w,
        tags: w.tags.filter((t) => t !== name),
      }));
      writeLs(TAGS_KEY, tags);
      writeLs(WORKFLOWS_KEY, workflows);
      return { tags, workflows };
    });
  },

  bulkDelete: (ids) => {
    set((s) => {
      const set2 = new Set(ids);
      const workflows = s.workflows.filter((w) => !set2.has(w.id));
      writeLs(WORKFLOWS_KEY, workflows);
      return { workflows };
    });
  },

  bulkArchive: (ids) => {
    set((s) => {
      const set2 = new Set(ids);
      const workflows = s.workflows.map((w) =>
        set2.has(w.id) ? { ...w, status: "archived" as WorkflowStatus, updatedAt: Date.now() } : w,
      );
      writeLs(WORKFLOWS_KEY, workflows);
      return { workflows };
    });
  },

  bulkSetStatus: (ids, status) => {
    set((s) => {
      const set2 = new Set(ids);
      const workflows = s.workflows.map((w) =>
        set2.has(w.id) ? { ...w, status, updatedAt: Date.now() } : w,
      );
      writeLs(WORKFLOWS_KEY, workflows);
      return { workflows };
    });
  },

  bulkMove: (ids, folderId) => {
    set((s) => {
      const set2 = new Set(ids);
      const workflows = s.workflows.map((w) =>
        set2.has(w.id) ? { ...w, folderId, updatedAt: Date.now() } : w,
      );
      writeLs(WORKFLOWS_KEY, workflows);
      return { workflows };
    });
  },

  bulkTag: (ids, tag) => {
    set((s) => {
      const set2 = new Set(ids);
      const workflows = s.workflows.map((w) =>
        set2.has(w.id) && !w.tags.includes(tag)
          ? { ...w, tags: [...w.tags, tag], updatedAt: Date.now() }
          : w,
      );
      const mergedTags = s.tags.includes(tag) ? s.tags : [...s.tags, tag];
      writeLs(WORKFLOWS_KEY, workflows);
      writeLs(TAGS_KEY, mergedTags);
      return { workflows, tags: mergedTags };
    });
  },
}));

export function resetWorkflowsStoreForTests(state: Partial<WorkflowsState>): void {
  useWorkflowsStore.setState({
    workflows: [],
    folders: [],
    projects: [],
    tags: [],
    ...state,
  });
}
