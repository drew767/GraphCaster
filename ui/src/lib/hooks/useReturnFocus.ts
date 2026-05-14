// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useRef } from "react";

/**
 * Restores focus to the element that was active before `open` became true,
 * once `open` flips back to false. Useful for dialogs/popovers/menus where
 * focus should return to the trigger when the surface closes.
 */
export function useReturnFocus(open: boolean): void {
  const triggerRef = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open && !wasOpen.current) {
      // Remember the element that opened us.
      const active = typeof document !== "undefined" ? document.activeElement : null;
      triggerRef.current = active instanceof HTMLElement ? active : null;
      wasOpen.current = true;
      return;
    }

    if (!open && wasOpen.current) {
      wasOpen.current = false;
      const target = triggerRef.current;
      triggerRef.current = null;
      if (target && typeof target.focus === "function") {
        // Defer focus to allow surface unmount/cleanup to finish first.
        const id = window.setTimeout(() => {
          try {
            target.focus();
          } catch {
            /* ignore */
          }
        }, 0);
        return () => window.clearTimeout(id);
      }
    }
    return;
  }, [open]);
}
