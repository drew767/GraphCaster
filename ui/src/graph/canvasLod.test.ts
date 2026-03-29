// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import {
  lodLevelForZoom,
  lodLevelWithHysteresis,
  ZOOM_LOD_COMPACT_BELOW,
  ZOOM_LOD_FULL_EXIT,
} from "./canvasLod";

describe("lodLevelForZoom", () => {
  it("returns full at threshold and above", () => {
    expect(lodLevelForZoom(ZOOM_LOD_COMPACT_BELOW)).toBe("full");
    expect(lodLevelForZoom(1)).toBe("full");
  });

  it("returns compact below threshold", () => {
    expect(lodLevelForZoom(ZOOM_LOD_COMPACT_BELOW - 1e-6)).toBe("compact");
    expect(lodLevelForZoom(0.2)).toBe("compact");
  });

  it("returns full-safe for non-finite or non-positive zoom", () => {
    expect(lodLevelForZoom(Number.NaN)).toBe("full");
    expect(lodLevelForZoom(Number.POSITIVE_INFINITY)).toBe("full");
    expect(lodLevelForZoom(0)).toBe("full");
    expect(lodLevelForZoom(-1)).toBe("full");
  });
});

describe("lodLevelWithHysteresis", () => {
  it("from full: same enter threshold as lodLevelForZoom", () => {
    expect(lodLevelWithHysteresis(ZOOM_LOD_COMPACT_BELOW, "full")).toBe("full");
    expect(lodLevelWithHysteresis(ZOOM_LOD_COMPACT_BELOW - 1e-6, "full")).toBe("compact");
  });

  it("from compact: stays compact between the two thresholds", () => {
    expect(lodLevelWithHysteresis(ZOOM_LOD_COMPACT_BELOW, "compact")).toBe("compact");
    expect(lodLevelWithHysteresis((ZOOM_LOD_COMPACT_BELOW + ZOOM_LOD_FULL_EXIT) / 2, "compact")).toBe(
      "compact",
    );
  });

  it("from compact: returns full above ZOOM_LOD_FULL_EXIT", () => {
    expect(lodLevelWithHysteresis(ZOOM_LOD_FULL_EXIT + 1e-6, "compact")).toBe("full");
  });

  it("invalid zoom resets to full regardless of prev", () => {
    expect(lodLevelWithHysteresis(Number.NaN, "compact")).toBe("full");
    expect(lodLevelWithHysteresis(-1, "compact")).toBe("full");
  });
});
