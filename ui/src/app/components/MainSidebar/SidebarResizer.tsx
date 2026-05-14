// Copyright GraphCaster. All Rights Reserved.

import React from "react";

export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 500;
export const SIDEBAR_DEFAULT_WIDTH = 220;
export const SIDEBAR_WIDTH_STORAGE_KEY = "gc.sidebar.width";

export function clampSidebarWidth(value: number): number {
  if (!Number.isFinite(value)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.round(value)));
}

export function readPersistedSidebarWidth(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (raw == null) return SIDEBAR_DEFAULT_WIDTH;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return SIDEBAR_DEFAULT_WIDTH;
    return clampSidebarWidth(parsed);
  } catch {
    return SIDEBAR_DEFAULT_WIDTH;
  }
}

export function persistSidebarWidth(width: number): void {
  try {
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(clampSidebarWidth(width)));
  } catch {
    // ignore
  }
}

export interface SidebarResizerProps {
  width: number;
  onWidthChange: (next: number) => void;
}

export function SidebarResizer({ width, onWidthChange }: SidebarResizerProps) {
  const widthRef = React.useRef(width);
  React.useEffect(() => {
    widthRef.current = width;
  }, [width]);

  const handlePointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = widthRef.current;

      const onMove = (ev: PointerEvent) => {
        const delta = ev.clientX - startX;
        const next = clampSidebarWidth(startWidth + delta);
        onWidthChange(next);
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        persistSidebarWidth(widthRef.current);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [onWidthChange],
  );

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      const next = clampSidebarWidth(widthRef.current - 8);
      onWidthChange(next);
      persistSidebarWidth(next);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      const next = clampSidebarWidth(widthRef.current + 8);
      onWidthChange(next);
      persistSidebarWidth(next);
    }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuemin={SIDEBAR_MIN_WIDTH}
      aria-valuemax={SIDEBAR_MAX_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      className="gc-main-sidebar__resizer"
      data-testid="sidebar-resizer"
      onPointerDown={handlePointerDown}
      onKeyDown={handleKeyDown}
    />
  );
}
