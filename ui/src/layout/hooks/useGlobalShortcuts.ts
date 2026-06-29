// Copyright GraphCaster. All Rights Reserved.

import { useEffect } from "react";

import { isTextEditingTarget } from "../../lib/isTextEditingTarget";

/**
 * Global window-level keyboard shortcut wiring for the AppShell.
 *
 * MAY:
 *   - Attach `keydown` listeners on `window` for app-wide chords.
 *   - Read the `isBlocking` flag to short-circuit shortcuts while a run is
 *     actively mutating the canvas.
 *   - Skip handling when the event target is a text-editing element.
 *
 * MUST NOT:
 *   - Own any state (the hook returns `void`); all reactive state lives in
 *     AppShell or its dedicated hooks.
 *   - Touch the DOM beyond `preventDefault()` on the captured event.
 *   - Reference graph/document/workspace data directly — only invoke the
 *     callbacks passed in by AppShell.
 *
 * Currently wires:
 *   - Ctrl/Cmd+Z       -> onUndo
 *   - Ctrl/Cmd+Y       -> onRedo
 *   - Ctrl/Cmd+Shift+Z -> onRedo
 *   - Ctrl/Cmd+Shift+N -> onToggleNodePalette
 */
export interface UseGlobalShortcutsParams {
  /** Returns true when the run session is blocking edits; undo/redo skip. */
  isBlocking: () => boolean;
  onUndo: () => void;
  onRedo: () => void;
  onToggleNodePalette: () => void;
}

export function useGlobalShortcuts(params: UseGlobalShortcutsParams): void {
  const { isBlocking, onUndo, onRedo, onToggleNodePalette } = params;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isBlocking()) {
        return;
      }
      if (isTextEditingTarget(e.target)) {
        return;
      }
      const key = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) {
        return;
      }
      if (key === "z") {
        if (e.shiftKey) {
          e.preventDefault();
          onRedo();
        } else {
          e.preventDefault();
          onUndo();
        }
        return;
      }
      if (key === "y") {
        e.preventDefault();
        onRedo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isBlocking, onRedo, onUndo]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTextEditingTarget(e.target)) {
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || !e.shiftKey) {
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "n") {
        e.preventDefault();
        onToggleNodePalette();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onToggleNodePalette]);
}
