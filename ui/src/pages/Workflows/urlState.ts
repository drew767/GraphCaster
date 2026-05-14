// Copyright GraphCaster. All Rights Reserved.

import type { WorkflowFilters, WorkflowView } from "./types";

export interface WorkflowsUrlState {
  filters: WorkflowFilters;
  page: number;
  perPage: number;
  view: WorkflowView;
}

export function readUrlState(search: string): WorkflowsUrlState {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const status = (params.get("status") ?? "all") as WorkflowFilters["status"];
  const tagsRaw = params.get("tag") ?? "";
  const tags = tagsRaw ? tagsRaw.split(",").filter(Boolean) : [];
  const project = params.get("project") || null;
  const searchQ = params.get("search") ?? "";
  const page = Number(params.get("page") ?? "1") || 1;
  const perPage = Number(params.get("perPage") ?? "50") || 50;
  const view = (params.get("view") ?? "all") as WorkflowView;
  return {
    filters: { search: searchQ, status, tags, project, folderId: null },
    page,
    perPage,
    view: view === "archived" ? "archived" : "all",
  };
}

export function writeUrlState(state: WorkflowsUrlState): string {
  const params = new URLSearchParams();
  if (state.filters.search) params.set("search", state.filters.search);
  if (state.filters.status !== "all") params.set("status", state.filters.status);
  if (state.filters.tags.length > 0) params.set("tag", state.filters.tags.join(","));
  if (state.filters.project) params.set("project", state.filters.project);
  if (state.page !== 1) params.set("page", String(state.page));
  if (state.perPage !== 50) params.set("perPage", String(state.perPage));
  if (state.view !== "all") params.set("view", state.view);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}
