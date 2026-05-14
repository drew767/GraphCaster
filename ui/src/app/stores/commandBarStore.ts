// Copyright GraphCaster. All Rights Reserved.

import { create } from "zustand";

const STORAGE_KEY_RECENT = "gc.commandBar.recentRoutes";
const STORAGE_KEY_FAVORITES = "gc.commandBar.favorites";
const MAX_RECENT = 10;
const MAX_RECENT_SHOWN = 5;

export { MAX_RECENT_SHOWN };

export interface RecentRouteEntry {
  href: string;
  label: string;
  /** ISO timestamp */
  visitedAt: string;
}

export interface FavoriteEntry {
  href: string;
  label: string;
}

interface CommandBarState {
  open: boolean;
  recentRoutes: RecentRouteEntry[];
  favorites: FavoriteEntry[];
  setOpen: (open: boolean) => void;
  toggle: () => void;
  pushRoute: (entry: Omit<RecentRouteEntry, "visitedAt">) => void;
  addFavorite: (entry: FavoriteEntry) => void;
  removeFavorite: (href: string) => void;
  isFavorite: (href: string) => boolean;
  toggleFavorite: (entry: FavoriteEntry) => void;
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    return parsed as T;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage may be unavailable in some environments
  }
}

export const useCommandBarStore = create<CommandBarState>((set, get) => ({
  open: false,
  recentRoutes: loadJson<RecentRouteEntry[]>(STORAGE_KEY_RECENT, []),
  favorites: loadJson<FavoriteEntry[]>(STORAGE_KEY_FAVORITES, []),

  setOpen: (open) => set({ open }),

  toggle: () => set((state) => ({ open: !state.open })),

  pushRoute: ({ href, label }) => {
    const now = new Date().toISOString();
    const existing = get().recentRoutes.filter((r) => r.href !== href);
    const updated: RecentRouteEntry[] = [{ href, label, visitedAt: now }, ...existing].slice(
      0,
      MAX_RECENT,
    );
    saveJson(STORAGE_KEY_RECENT, updated);
    set({ recentRoutes: updated });
  },

  addFavorite: ({ href, label }) => {
    const existing = get().favorites.filter((f) => f.href !== href);
    const updated: FavoriteEntry[] = [{ href, label }, ...existing];
    saveJson(STORAGE_KEY_FAVORITES, updated);
    set({ favorites: updated });
  },

  removeFavorite: (href) => {
    const updated = get().favorites.filter((f) => f.href !== href);
    saveJson(STORAGE_KEY_FAVORITES, updated);
    set({ favorites: updated });
  },

  isFavorite: (href) => get().favorites.some((f) => f.href === href),

  toggleFavorite: ({ href, label }) => {
    if (get().isFavorite(href)) {
      get().removeFavorite(href);
    } else {
      get().addFavorite({ href, label });
    }
  },
}));
