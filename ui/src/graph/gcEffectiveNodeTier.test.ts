// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import { resolveEffectiveTier } from "./viewportNodeTier";

describe("resolveEffectiveTier", () => {
  it("ghost disabled → lod only", () => {
    expect(
      resolveEffectiveTier("full", "off", { ghostOffViewportEnabled: false, selected: false }),
    ).toBe("full");
    expect(
      resolveEffectiveTier("compact", "off", { ghostOffViewportEnabled: false, selected: false }),
    ).toBe("compact");
  });

  it("off + enabled + not selected → ghost", () => {
    expect(
      resolveEffectiveTier("full", "off", { ghostOffViewportEnabled: true, selected: false }),
    ).toBe("ghost");
    expect(
      resolveEffectiveTier("compact", "off", { ghostOffViewportEnabled: true, selected: false }),
    ).toBe("ghost");
  });

  it("selected never ghost", () => {
    expect(
      resolveEffectiveTier("full", "off", { ghostOffViewportEnabled: true, selected: true }),
    ).toBe("full");
  });

  it("in/pad → lod", () => {
    expect(
      resolveEffectiveTier("compact", "in", { ghostOffViewportEnabled: true, selected: false }),
    ).toBe("compact");
    expect(
      resolveEffectiveTier("full", "pad", { ghostOffViewportEnabled: true, selected: false }),
    ).toBe("full");
  });
});
