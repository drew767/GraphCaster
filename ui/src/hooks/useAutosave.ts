// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useEffect, useRef } from "react";

/** Default debounce wait before firing the trailing autosave (per marker UXP126). */
export const AUTOSAVE_DEBOUNCE_MS = 2000;

/** When a graph has more than this many nodes, also throttle at LARGE_GRAPH_THROTTLE_MS. */
export const LARGE_GRAPH_NODE_THRESHOLD = 50;
export const LARGE_GRAPH_THROTTLE_MS = 5000;

export interface UseAutosaveOptions<T> {
  /** Pull the value to save (called inside the debounced callback). */
  getValue: () => T;
  /** Persist a value. Should be idempotent — the hook does not retry. */
  save: (value: T) => void | Promise<void>;
  /** Custom debounce (default 2000 ms). */
  debounceMs?: number;
  /** Estimated node count for the graph; used to apply a throttle floor. */
  nodeCount?: number;
  /** Override the large-graph node threshold. */
  largeGraphThreshold?: number;
  /** Override the throttle interval for large graphs. */
  throttleMs?: number;
  /** When false, schedule() does nothing. */
  enabled?: boolean;
}

export interface UseAutosaveReturn {
  /** Schedule a debounced save. */
  schedule: () => void;
  /** Force a save now and clear pending debounce. */
  flush: () => void;
  /** Cancel any pending save. */
  cancel: () => void;
}

/**
 * Debounced workflow autosave. Trailing-edge fires after the user pauses for
 * `debounceMs` (default 2000 ms). When the graph is large
 * (`nodeCount > LARGE_GRAPH_NODE_THRESHOLD`), an additional throttle floor
 * (default 5000 ms) prevents bursts of saves.
 */
export function useAutosave<T>(options: UseAutosaveOptions<T>): UseAutosaveReturn {
  const {
    getValue,
    save,
    debounceMs = AUTOSAVE_DEBOUNCE_MS,
    nodeCount = 0,
    largeGraphThreshold = LARGE_GRAPH_NODE_THRESHOLD,
    throttleMs = LARGE_GRAPH_THROTTLE_MS,
    enabled = true,
  } = options;

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFiredAtRef = useRef<number>(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const doSave = useCallback(() => {
    lastFiredAtRef.current = Date.now();
    void save(getValue());
  }, [getValue, save]);

  const schedule = useCallback(() => {
    if (!enabled) return;
    clearTimer();
    let wait = debounceMs;
    if (nodeCount > largeGraphThreshold) {
      const sinceLast = Date.now() - lastFiredAtRef.current;
      const remaining = Math.max(0, throttleMs - sinceLast);
      if (remaining > wait) {
        wait = remaining;
      }
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      doSave();
    }, wait);
  }, [
    enabled,
    clearTimer,
    debounceMs,
    nodeCount,
    largeGraphThreshold,
    throttleMs,
    doSave,
  ]);

  const flush = useCallback(() => {
    clearTimer();
    doSave();
  }, [clearTimer, doSave]);

  const cancel = useCallback(() => {
    clearTimer();
  }, [clearTimer]);

  useEffect(() => clearTimer, [clearTimer]);

  return { schedule, flush, cancel };
}
