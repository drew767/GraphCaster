// Copyright GraphCaster. All Rights Reserved.

/** Visual detail level for custom nodes (n8n/Dify-style simplification when zoomed out). */
export type GcCanvasLodLevel = "full" | "compact";

/** From **full**, switch to **compact** when zoom (`transform[2]`) drops strictly below this. */
export const ZOOM_LOD_COMPACT_BELOW = 0.5;

/**
 * From **compact**, switch back to **full** when zoom rises strictly above this (hysteresis vs
 * {@link ZOOM_LOD_COMPACT_BELOW} — avoids flicker when pan-zoom dances near the boundary).
 */
export const ZOOM_LOD_FULL_EXIT = 0.55;

/** One-shot level (no memory). Prefer {@link lodLevelWithHysteresis} on the live canvas. */
export function lodLevelForZoom(zoom: number): GcCanvasLodLevel {
  if (!Number.isFinite(zoom) || zoom <= 0) {
    return "full";
  }
  return zoom < ZOOM_LOD_COMPACT_BELOW ? "compact" : "full";
}

/**
 * Level with hysteresis: exiting compact requires a higher zoom than entering it.
 * Invalid zoom always yields **full** (same as {@link lodLevelForZoom}).
 */
export function lodLevelWithHysteresis(zoom: number, prev: GcCanvasLodLevel): GcCanvasLodLevel {
  if (!Number.isFinite(zoom) || zoom <= 0) {
    return "full";
  }
  if (prev === "full") {
    return zoom < ZOOM_LOD_COMPACT_BELOW ? "compact" : "full";
  }
  return zoom > ZOOM_LOD_FULL_EXIT ? "full" : "compact";
}
