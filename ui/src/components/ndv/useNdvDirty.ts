// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useEffect, useRef, useState } from "react";

export interface UseNdvDirtyReturn {
  dirty: boolean;
  errors: Record<string, string>;
  markDirty: () => void;
  markClean: () => void;
  setError: (path: string, message: string | null) => void;
}

const AUTOSAVE_DEBOUNCE_MS = 500;

export function useNdvDirty(onAutosave?: () => void): UseNdvDirtyReturn {
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const markDirty = useCallback(() => {
    setDirty(true);
    clearTimer();
    if (onAutosave) {
      timerRef.current = setTimeout(() => {
        onAutosave();
      }, AUTOSAVE_DEBOUNCE_MS);
    }
  }, [clearTimer, onAutosave]);

  const markClean = useCallback(() => {
    clearTimer();
    setDirty(false);
    setErrors({});
  }, [clearTimer]);

  const setError = useCallback((path: string, message: string | null) => {
    setErrors((prev) => {
      if (message === null) {
        if (!(path in prev)) return prev;
        const next = { ...prev };
        delete next[path];
        return next;
      }
      if (prev[path] === message) return prev;
      return { ...prev, [path]: message };
    });
  }, []);

  useEffect(() => {
    return () => {
      clearTimer();
    };
  }, [clearTimer]);

  return { dirty, errors, markDirty, markClean, setError };
}
