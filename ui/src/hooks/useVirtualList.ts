// Copyright GraphCaster. All Rights Reserved.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export type VirtualListConfig = {
  itemCount: number;
  itemHeight: number;
  overscan?: number;
  estimatedViewportHeight?: number;
};

export type VirtualListResult = {
  /** Ref for the scrollable container. */
  containerRef: (node: HTMLDivElement | null) => void;
  /** Inclusive index of the first row to render. */
  startIndex: number;
  /** Exclusive index past the last row to render. */
  endIndex: number;
  /** Total height of the inner spacer (itemCount * itemHeight). */
  totalHeight: number;
  /** Top offset of the first rendered row (startIndex * itemHeight). */
  offsetTop: number;
  /** Scroll handler to attach to the container. */
  onScroll: (event: React.UIEvent<HTMLDivElement>) => void;
  /** Imperatively scroll to a row index (useful for follow-cursor / pin-to-bottom). */
  scrollToIndex: (index: number, align?: "start" | "center" | "end") => void;
  /** Manually mark the container dirty (e.g. after resize). */
  remeasure: () => void;
};

/**
 * Minimal vertical windowing primitive: fixed row height, no external deps.
 * Renders `[startIndex, endIndex)` rows; caller is responsible for positioning
 * the inner spacer with `position: relative; height: totalHeight` and shifting
 * the rendered slice by `translateY(offsetTop)`.
 */
export function useVirtualList(config: VirtualListConfig): VirtualListResult {
  const {
    itemCount,
    itemHeight,
    overscan = 5,
    estimatedViewportHeight = 320,
  } = config;

  const containerEl = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(estimatedViewportHeight);

  const measure = useCallback(() => {
    const el = containerEl.current;
    if (el == null) {
      return;
    }
    const next = el.clientHeight;
    if (next > 0) {
      setViewportHeight(next);
    }
  }, []);

  const setContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      containerEl.current = node;
      if (node != null) {
        const next = node.clientHeight;
        if (next > 0) {
          setViewportHeight(next);
        }
        setScrollTop(node.scrollTop);
      }
    },
    [],
  );

  useLayoutEffect(() => {
    measure();
  }, [measure, itemCount]);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const el = containerEl.current;
    if (el == null) {
      return;
    }
    const ro = new ResizeObserver(() => {
      measure();
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, [measure]);

  const onScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  const scrollToIndex = useCallback(
    (index: number, align: "start" | "center" | "end" = "start") => {
      const el = containerEl.current;
      if (el == null || itemHeight <= 0) {
        return;
      }
      const clamped = Math.max(0, Math.min(index, itemCount - 1));
      const rowTop = clamped * itemHeight;
      let target = rowTop;
      if (align === "center") {
        target = rowTop - el.clientHeight / 2 + itemHeight / 2;
      } else if (align === "end") {
        target = rowTop - el.clientHeight + itemHeight;
      }
      el.scrollTop = Math.max(0, Math.min(target, itemCount * itemHeight - el.clientHeight));
      setScrollTop(el.scrollTop);
    },
    [itemCount, itemHeight],
  );

  const safeItemHeight = itemHeight > 0 ? itemHeight : 1;
  const visibleCount =
    safeItemHeight > 0 ? Math.max(1, Math.ceil(viewportHeight / safeItemHeight)) : itemCount;

  const rawStart = Math.floor(scrollTop / safeItemHeight);
  const startIndex = Math.max(0, rawStart - overscan);
  const endIndex = Math.min(itemCount, rawStart + visibleCount + overscan);

  return {
    containerRef: setContainerRef,
    startIndex,
    endIndex,
    totalHeight: itemCount * itemHeight,
    offsetTop: startIndex * itemHeight,
    onScroll,
    scrollToIndex,
    remeasure: measure,
  };
}
