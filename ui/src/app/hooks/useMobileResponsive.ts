// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useState } from "react";

const MOBILE_MAX_WIDTH_PX = 768;

function readInitial(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH_PX}px)`).matches;
}

/**
 * Subscribes to `(max-width: 768px)` and returns the current state.
 * When true, the app shows a read-only mobile view.
 */
export function useMobileResponsive(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(readInitial);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mq = window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH_PX}px)`);
    const onChange = (e: MediaQueryListEvent): void => {
      setIsMobile(e.matches);
    };
    mq.addEventListener("change", onChange);
    return () => {
      mq.removeEventListener("change", onChange);
    };
  }, []);

  return isMobile;
}
