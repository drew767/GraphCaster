// Copyright GraphCaster. All Rights Reserved.

import { useEffect } from "react";

import { isTextEditingTarget } from "../../lib/isTextEditingTarget";

export interface GlobalHotkeysOptions {
  onShowShortcuts: () => void;
}

/**
 * Registers application-wide keyboard hotkeys that are not specific to the
 * canvas, command bar or NDV. Currently:
 *  - `?` opens the keyboard shortcuts modal (Shift+/ on US layouts).
 *
 * Hotkeys are suppressed while a text-editing surface holds focus so that
 * typing the literal character into an input still works as expected.
 */
export function useGlobalHotkeys({ onShowShortcuts }: GlobalHotkeysOptions): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      if (isTextEditingTarget(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "?") {
        e.preventDefault();
        onShowShortcuts();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onShowShortcuts]);
}
