// Copyright GraphCaster. All Rights Reserved.

import { create } from "zustand";

export const EDITOR_UI_SNAP_KEY = "gc.editor.snap";
export const EDITOR_UI_LOCK_KEY = "gc.editor.lock";

function readBool(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return fallback;
  }
  const v = window.localStorage.getItem(key);
  if (v === null) {
    return fallback;
  }
  return v === "1" || v === "true";
}

function writeBool(key: string, value: boolean): void {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return;
  }
  window.localStorage.setItem(key, value ? "1" : "0");
}

interface EditorUiState {
  snapToGrid: boolean;
  canvasLocked: boolean;
  setSnapToGrid: (v: boolean) => void;
  toggleSnapToGrid: () => void;
  setCanvasLocked: (v: boolean) => void;
  toggleCanvasLocked: () => void;
}

export const useEditorUiStore = create<EditorUiState>((set, get) => ({
  snapToGrid: readBool(EDITOR_UI_SNAP_KEY, false),
  canvasLocked: readBool(EDITOR_UI_LOCK_KEY, false),

  setSnapToGrid: (v) => {
    writeBool(EDITOR_UI_SNAP_KEY, v);
    set({ snapToGrid: v });
  },

  toggleSnapToGrid: () => {
    const next = !get().snapToGrid;
    writeBool(EDITOR_UI_SNAP_KEY, next);
    set({ snapToGrid: next });
  },

  setCanvasLocked: (v) => {
    writeBool(EDITOR_UI_LOCK_KEY, v);
    set({ canvasLocked: v });
  },

  toggleCanvasLocked: () => {
    const next = !get().canvasLocked;
    writeBool(EDITOR_UI_LOCK_KEY, next);
    set({ canvasLocked: next });
  },
}));
