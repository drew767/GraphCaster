// Copyright GraphCaster. All Rights Reserved.

/**
 * MiniMap chrome (viewport mask, frame stroke, widget background).
 *
 * Uses @xyflow/react `MiniMap` SVG props — not CSS variables (see
 * https://reactflow.dev/api-reference/components/minimap — `maskColor`, `maskStrokeColor`, …).
 *
 * Palette mirrors `ui/src/styles/tokens.css` (same literals as `minimapNodeColors.ts` / canvas — update
 * both if tokens change). Light: `bgColor` = `--gc-surface-1`, viewport frame = `--gc-accent`.
 * Dark: `bgColor` = `--gc-surface-1`; viewport frame = `--gc-accent-hover` (not `--gc-accent`) for
 * stronger contrast on the minimap; changing to primary accent would wash out the frame.
 */

export type MinimapChrome = {
  bgColor: string;
  maskColor: string;
  maskStrokeColor: string;
  maskStrokeWidth: number;
};

/** Light: `--gc-surface-1`; mask outside viewport; frame `--gc-accent` (`#007aff`). */
const CHROME_LIGHT: MinimapChrome = {
  bgColor: "#ffffff",
  maskColor: "rgba(15, 23, 42, 0.38)",
  maskStrokeColor: "#007aff",
  maskStrokeWidth: 2,
};

/**
 * Dark: `--gc-surface-1`; stronger mask outside viewport; frame `--gc-accent-hover` (`#409cff`) for
 * readable viewport outline on small minimap (see module doc).
 */
const CHROME_DARK: MinimapChrome = {
  bgColor: "#161618",
  maskColor: "rgba(0, 0, 0, 0.52)",
  maskStrokeColor: "#409cff",
  maskStrokeWidth: 2,
};

export function minimapChromeForTheme(isDark: boolean): MinimapChrome {
  return isDark ? CHROME_DARK : CHROME_LIGHT;
}
