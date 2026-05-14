// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useState, type KeyboardEvent } from "react";

export interface UseListNavOptions {
  /** Initial focused index (defaults to 0). */
  initialIndex?: number;
  /** Fired when Space is pressed on the focused item. */
  onSelect?: (index: number) => void;
  /** When true the focus wraps from last to first and vice versa. */
  wrap?: boolean;
}

export interface UseListNavResult<T> {
  focusedIndex: number;
  setFocusedIndex: (index: number) => void;
  handleKeyDown: (event: KeyboardEvent) => void;
  /** Helpers for wiring list items to the hook. */
  getItemProps: (index: number) => {
    tabIndex: number;
    "aria-selected": boolean;
    onFocus: () => void;
    onKeyDown: (event: KeyboardEvent) => void;
  };
  items: T[];
}

export function useListNav<T>(
  items: T[],
  onActivate: (item: T, index: number) => void,
  options: UseListNavOptions = {},
): UseListNavResult<T> {
  const { initialIndex = 0, onSelect, wrap = false } = options;
  const [focusedIndex, setFocusedIndexState] = useState<number>(() =>
    clamp(initialIndex, items.length),
  );

  const setFocusedIndex = useCallback(
    (idx: number) => {
      setFocusedIndexState(clamp(idx, items.length));
    },
    [items.length],
  );

  const move = useCallback(
    (delta: number) => {
      setFocusedIndexState((prev) => {
        const len = items.length;
        if (len === 0) return 0;
        let next = prev + delta;
        if (wrap) {
          next = ((next % len) + len) % len;
        } else {
          next = Math.max(0, Math.min(len - 1, next));
        }
        return next;
      });
    },
    [items.length, wrap],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const len = items.length;
      if (len === 0) return;

      switch (event.key) {
        case "ArrowDown":
          event.preventDefault();
          move(1);
          return;
        case "ArrowUp":
          event.preventDefault();
          move(-1);
          return;
        case "Home":
          event.preventDefault();
          setFocusedIndexState(0);
          return;
        case "End":
          event.preventDefault();
          setFocusedIndexState(len - 1);
          return;
        case "Enter": {
          event.preventDefault();
          const item = items[focusedIndex];
          if (item !== undefined) onActivate(item, focusedIndex);
          return;
        }
        case " ":
        case "Spacebar": {
          if (onSelect) {
            event.preventDefault();
            onSelect(focusedIndex);
          }
          return;
        }
        default:
          return;
      }
    },
    [items, focusedIndex, move, onActivate, onSelect],
  );

  const getItemProps = useCallback(
    (index: number) => ({
      tabIndex: index === focusedIndex ? 0 : -1,
      "aria-selected": index === focusedIndex,
      onFocus: () => setFocusedIndexState(index),
      onKeyDown: handleKeyDown,
    }),
    [focusedIndex, handleKeyDown],
  );

  return {
    focusedIndex,
    setFocusedIndex,
    handleKeyDown,
    getItemProps,
    items,
  };
}

function clamp(value: number, length: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(length - 1, value));
}
