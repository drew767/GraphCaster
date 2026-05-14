// Copyright GraphCaster. All Rights Reserved.

import { create } from "zustand";

export type Theme = "light" | "dark" | "auto";

export interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  effective: () => "light" | "dark";
}

const STORAGE_KEY = "gc-theme";

function readPersistedTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "auto") {
      return stored;
    }
  } catch {
    // ignore
  }
  return "auto";
}

function applyTheme(theme: Theme): void {
  const effective = resolveEffective(theme);
  document.documentElement.dataset.theme = effective;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore
  }
}

function resolveEffective(theme: Theme): "light" | "dark" {
  if (theme === "auto") {
    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return "light";
  }
  return theme;
}

const initialTheme = readPersistedTheme();
applyTheme(initialTheme);

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: initialTheme,

  setTheme: (theme: Theme) => {
    applyTheme(theme);
    set({ theme });
  },

  effective: () => resolveEffective(get().theme),
}));
