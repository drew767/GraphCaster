// Copyright GraphCaster. All Rights Reserved.

import { useEffect, useState } from "react";

/**
 * Minimal hash-based route param resolver.
 * Reads the current location for the pattern `#/executions/:runId` and returns `{ runId }`.
 * Tests can override by passing `initial`.
 */
export function useParams(initial?: Record<string, string>): Record<string, string> {
  const compute = (): Record<string, string> => {
    if (initial) {
      return initial;
    }
    if (typeof window === "undefined") {
      return {};
    }
    const hash = window.location.hash || "";
    const m = hash.match(/^#\/executions\/([^/?#]+)/);
    if (m && m[1]) {
      return { runId: decodeURIComponent(m[1]) };
    }
    const p = window.location.pathname || "";
    const m2 = p.match(/\/executions\/([^/?#]+)/);
    if (m2 && m2[1]) {
      return { runId: decodeURIComponent(m2[1]) };
    }
    return {};
  };

  const [params, setParams] = useState<Record<string, string>>(() => compute());

  useEffect(() => {
    if (initial) {
      return;
    }
    const onChange = () => {
      setParams(compute());
    };
    window.addEventListener("hashchange", onChange);
    window.addEventListener("popstate", onChange);
    return () => {
      window.removeEventListener("hashchange", onChange);
      window.removeEventListener("popstate", onChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return params;
}

export function navigateTo(path: string): void {
  if (typeof window === "undefined") {
    return;
  }
  if (path.startsWith("#")) {
    window.location.hash = path.slice(1);
    return;
  }
  window.location.hash = `/${path.replace(/^\/+/, "")}`;
}
