// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import { minimapChromeForTheme } from "./minimapChrome";

describe("minimapChromeForTheme", () => {
  it("light theme matches tokens.css surface-1, accent, and non-transparent frame", () => {
    const c = minimapChromeForTheme(false);
    expect(c.bgColor).toBe("#ffffff");
    expect(c.maskStrokeColor).toBe("#007aff");
    expect(c.maskStrokeWidth).toBe(2);
    expect(c.maskColor).toBe("rgba(15, 23, 42, 0.38)");
  });

  it("dark theme matches tokens.css surface-1, accent-hover frame, and distinct mask", () => {
    const dark = minimapChromeForTheme(true);
    const light = minimapChromeForTheme(false);
    expect(dark.bgColor).toBe("#161618");
    expect(dark.maskStrokeColor).toBe("#409cff");
    expect(dark.maskStrokeWidth).toBe(2);
    expect(dark.maskColor).toBe("rgba(0, 0, 0, 0.52)");
    expect(dark.bgColor).not.toBe(light.bgColor);
    expect(dark.maskColor).not.toBe(light.maskColor);
  });
});
