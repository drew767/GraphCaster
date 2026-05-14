// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useEffect, useRef, useState } from "react";
import type { PausedRunItem } from "./types";

const POLL_INTERVAL_MS = 5_000;

interface UsePausedRunsResult {
  items: PausedRunItem[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function usePausedRuns(apiBase = "/api/v1"): UsePausedRunsResult {
  const [items, setItems] = useState<PausedRunItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchPaused = useCallback(async () => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${apiBase}/runs/paused`, { signal: controller.signal });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as { items: PausedRunItem[] };
      setItems(data.items ?? []);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  const refresh = useCallback(() => {
    void fetchPaused();
  }, [fetchPaused]);

  useEffect(() => {
    void fetchPaused();

    const schedule = () => {
      timerRef.current = setTimeout(() => {
        void fetchPaused().then(() => {
          schedule();
        });
      }, POLL_INTERVAL_MS);
    };
    schedule();

    return () => {
      if (timerRef.current != null) {
        clearTimeout(timerRef.current);
      }
      if (abortRef.current) {
        abortRef.current.abort();
      }
    };
  }, [fetchPaused]);

  return { items, loading, error, refresh };
}
