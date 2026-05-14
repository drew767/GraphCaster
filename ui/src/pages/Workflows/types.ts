// Copyright GraphCaster. All Rights Reserved.

export type WorkflowStatus = "active" | "inactive" | "archived";

export interface Workflow {
  id: string;
  name: string;
  status: WorkflowStatus;
  tags: string[];
  folderId: string | null;
  projectId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
}

export interface Project {
  id: string;
  name: string;
}

export type SortKey =
  | "name-asc"
  | "name-desc"
  | "updated-desc"
  | "updated-asc"
  | "created-desc"
  | "created-asc"
  | "active-first";

export type WorkflowView = "all" | "archived";

export interface WorkflowFilters {
  search: string;
  status: "all" | WorkflowStatus;
  tags: string[];
  project: string | null;
  folderId: string | null;
}
