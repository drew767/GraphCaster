// Copyright GraphCaster. All Rights Reserved.
// UX74 — localStorage hook for recently used node types.

import { useCallback, useMemo, useState } from "react";

const STORAGE_KEY = "gc.nodeCreator.recentlyUsed";
const MAX_RECENT = 5;

function readFromStorage(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((v) => typeof v === "string").slice(0, MAX_RECENT);
    }
  } catch {
    // ignore parse errors
  }
  return [];
}

function writeToStorage(recent: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(recent));
  } catch {
    // ignore storage errors (e.g. private mode / quota)
  }
}

export function useRecentlyUsedNodes(): {
  recentNodeTypes: string[];
  recordUsage: (nodeType: string) => void;
} {
  const [recentNodeTypes, setRecentNodeTypes] = useState<string[]>(() => readFromStorage());

  const recordUsage = useCallback((nodeType: string) => {
    setRecentNodeTypes((prev) => {
      const next = [nodeType, ...prev.filter((t) => t !== nodeType)].slice(0, MAX_RECENT);
      writeToStorage(next);
      return next;
    });
  }, []);

  return useMemo(() => ({ recentNodeTypes, recordUsage }), [recentNodeTypes, recordUsage]);
}
