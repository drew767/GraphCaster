// Copyright GraphCaster. All Rights Reserved.

/**
 * Run visualization motion: full (pulse + animated edge), minimal (edge only), off (static outlines).
 * Aligns with PRODUCT_DESIGNE §11 — optional simplification / reduced motion.
 */

export const RUN_MOTION_STORAGE_KEY = "gc-editor-run-motion";

export type RunMotionPreference = "full" | "minimal" | "off";

export function normalizeRunMotionPreference(raw: string | null): RunMotionPreference {
  if (raw === "minimal" || raw === "off") {
    return raw;
  }
  return "full";
}

export function readRunMotionPreference(): RunMotionPreference {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return "full";
  }
  return normalizeRunMotionPreference(window.localStorage.getItem(RUN_MOTION_STORAGE_KEY));
}

export function writeRunMotionPreference(mode: RunMotionPreference): void {
  if (typeof window === "undefined" || typeof window.localStorage === "undefined") {
    return;
  }
  window.localStorage.setItem(RUN_MOTION_STORAGE_KEY, mode);
}

/** Animated dashed edge (React Flow) — full and minimal; not when off. */
export function runMotionAllowsEdgeAnimation(mode: RunMotionPreference): boolean {
  return mode === "full" || mode === "minimal";
}

/** CSS pulse on running node — full only. */
export function runMotionAllowsNodePulse(mode: RunMotionPreference): boolean {
  return mode === "full";
}

/**
 * React Flow edge `animated` respects reduced-motion (unlike CSS-only node pulse).
 * Static highlight (`gc-edge--run-active` stroke) still applies when the mode allows.
 */
export function effectiveRunEdgeAnimated(
  mode: RunMotionPreference,
  prefersReducedMotion: boolean,
): boolean {
  return runMotionAllowsEdgeAnimation(mode) && !prefersReducedMotion;
}

/** Skip pulse class when the OS asks for reduced motion (avoids relying on CSS override alone). */
export function effectiveRunNodePulse(
  mode: RunMotionPreference,
  prefersReducedMotion: boolean,
): boolean {
  return runMotionAllowsNodePulse(mode) && !prefersReducedMotion;
}
