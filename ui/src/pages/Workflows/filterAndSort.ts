// Copyright GraphCaster. All Rights Reserved.

import type { SortKey, Workflow, WorkflowFilters, WorkflowView } from "./types";

export function applyFilters(
  workflows: Workflow[],
  filters: WorkflowFilters,
  view: WorkflowView,
): Workflow[] {
  return workflows.filter((w) => {
    if (view === "archived") {
      if (w.status !== "archived") return false;
    } else {
      if (w.status === "archived" && filters.status !== "archived") return false;
    }
    if (filters.status !== "all" && w.status !== filters.status) return false;
    if (filters.folderId !== null && w.folderId !== filters.folderId) return false;
    if (filters.project !== null && w.projectId !== filters.project) return false;
    if (filters.tags.length > 0) {
      const all = filters.tags.every((t) => w.tags.includes(t));
      if (!all) return false;
    }
    if (filters.search) {
      const q = filters.search.toLowerCase();
      if (!w.name.toLowerCase().includes(q)) return false;
    }
    return true;
  });
}

export function applySort(items: Workflow[], key: SortKey): Workflow[] {
  const arr = items.slice();
  switch (key) {
    case "name-asc":
      arr.sort((a, b) => a.name.localeCompare(b.name));
      break;
    case "name-desc":
      arr.sort((a, b) => b.name.localeCompare(a.name));
      break;
    case "updated-desc":
      arr.sort((a, b) => b.updatedAt - a.updatedAt);
      break;
    case "updated-asc":
      arr.sort((a, b) => a.updatedAt - b.updatedAt);
      break;
    case "created-desc":
      arr.sort((a, b) => b.createdAt - a.createdAt);
      break;
    case "created-asc":
      arr.sort((a, b) => a.createdAt - b.createdAt);
      break;
    case "active-first":
      arr.sort((a, b) => statusRank(a) - statusRank(b) || b.updatedAt - a.updatedAt);
      break;
  }
  return arr;
}

function statusRank(w: Workflow): number {
  if (w.status === "active") return 0;
  if (w.status === "inactive") return 1;
  return 2;
}
