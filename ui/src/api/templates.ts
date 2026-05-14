// Copyright GraphCaster. All Rights Reserved.

import { LOCAL_TEMPLATES } from "./templates.local";

export interface TemplateAuthor {
  name: string;
  avatarUrl?: string;
}

export interface TemplateMeta {
  id: string;
  name: string;
  description: string;
  author: TemplateAuthor;
  categories: string[];
  nodes: string[];
  workflow: unknown;
  createdAt: string;
  views: number;
  tags?: string[];
  coverUrl?: string;
}

export interface ListTemplatesOptions {
  search?: string;
  categories?: string[];
  sort?: "views" | "created";
}

type Fetcher = typeof fetch;

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  fetchedAt: number;
  data: TemplateMeta[];
}

const cache: Map<string, CacheEntry> = new Map();

function getRemoteUrl(): string | undefined {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const url = env?.VITE_TEMPLATE_API_URL;
  return url && url.length > 0 ? url : undefined;
}

export interface ApiDeps {
  remoteUrl?: string | null;
  fetchFn?: Fetcher;
  now?: () => number;
}

async function fetchRemote(url: string, fetchFn: Fetcher): Promise<TemplateMeta[]> {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as TemplateMeta[] | { items: TemplateMeta[] };
  if (Array.isArray(data)) return data;
  return data.items ?? [];
}

async function loadAll(deps?: ApiDeps): Promise<TemplateMeta[]> {
  const explicit = deps?.remoteUrl;
  const remote = explicit === undefined ? getRemoteUrl() : explicit ?? undefined;
  const now = (deps?.now ?? (() => Date.now()))();
  const cacheKey = remote ?? "__local__";
  const hit = cache.get(cacheKey);
  if (hit && now - hit.fetchedAt < CACHE_TTL_MS) {
    return hit.data;
  }
  let data: TemplateMeta[];
  if (remote) {
    try {
      data = await fetchRemote(remote, deps?.fetchFn ?? fetch);
    } catch {
      data = LOCAL_TEMPLATES;
    }
  } else {
    data = LOCAL_TEMPLATES;
  }
  cache.set(cacheKey, { fetchedAt: now, data });
  return data;
}

function applyFilters(
  list: TemplateMeta[],
  opts?: ListTemplatesOptions,
): TemplateMeta[] {
  let out = list.slice();
  if (opts?.search) {
    const q = opts.search.trim().toLowerCase();
    if (q.length > 0) {
      out = out.filter((tpl) => {
        const hay = [
          tpl.name,
          tpl.description,
          ...(tpl.tags ?? []),
          ...tpl.categories,
        ]
          .join(" ")
          .toLowerCase();
        return hay.includes(q);
      });
    }
  }
  if (opts?.categories && opts.categories.length > 0) {
    const wanted = new Set(opts.categories);
    out = out.filter((tpl) => tpl.categories.some((c) => wanted.has(c)));
  }
  if (opts?.sort === "views") {
    out.sort((a, b) => b.views - a.views);
  } else if (opts?.sort === "created") {
    out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  return out;
}

export async function listTemplates(
  opts?: ListTemplatesOptions,
  deps?: ApiDeps,
): Promise<TemplateMeta[]> {
  const all = await loadAll(deps);
  return applyFilters(all, opts);
}

export async function getTemplate(
  id: string,
  deps?: ApiDeps,
): Promise<TemplateMeta | null> {
  const all = await loadAll(deps);
  return all.find((tpl) => tpl.id === id) ?? null;
}

export function __clearTemplateCache(): void {
  cache.clear();
}
