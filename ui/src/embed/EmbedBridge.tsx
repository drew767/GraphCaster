// Copyright GraphCaster. All Rights Reserved.

import { useEffect } from "react";

import { initEmbedHost } from "./host";

export interface EmbedBridgeProps {
  /** When provided, only messages from this origin are accepted. */
  origin?: string;
  /** Force-enable/disable embed mode (defaults to detecting iframe). */
  enabled?: boolean;
  /** Optional navigation callback. When omitted, falls back to window.location. */
  onNavigate?: (path: string) => void;
}

function detectEmbedded(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window !== window.parent;
  } catch {
    return true;
  }
}

function defaultNavigate(path: string): void {
  if (typeof window === "undefined") return;
  try {
    window.history.pushState({}, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  } catch {
    /* ignore */
  }
}

export function EmbedBridge({ origin, enabled, onNavigate }: EmbedBridgeProps = {}) {
  useEffect(() => {
    const active = enabled ?? detectEmbedded();
    if (!active) return;
    const handle = initEmbedHost({
      origin,
      handlers: {
        navigate: (path: string) => (onNavigate ?? defaultNavigate)(path),
      },
    });
    return () => handle.dispose();
  }, [origin, enabled, onNavigate]);

  return null;
}

export default EmbedBridge;
