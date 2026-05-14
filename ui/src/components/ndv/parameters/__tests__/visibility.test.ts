// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect } from "vitest";

import { isVisible } from "../visibility";

describe("isVisible predicate", () => {
  it("returns true when displayOptions is undefined", () => {
    expect(isVisible({}, { mode: "id" })).toBe(true);
  });

  it("show: returns true when current value matches the allow-list", () => {
    const param = { displayOptions: { show: { mode: ["id", "url"] } } };
    expect(isVisible(param, { mode: "id" })).toBe(true);
  });

  it("show: returns false when current value is not in the allow-list", () => {
    const param = { displayOptions: { show: { mode: ["id", "url"] } } };
    expect(isVisible(param, { mode: "list" })).toBe(false);
  });

  it("hide: returns false when current value matches the deny-list", () => {
    const param = { displayOptions: { hide: { mode: ["list"] } } };
    expect(isVisible(param, { mode: "list" })).toBe(false);
  });

  it("hide: returns true when current value is not in the deny-list", () => {
    const param = { displayOptions: { hide: { mode: ["list"] } } };
    expect(isVisible(param, { mode: "id" })).toBe(true);
  });

  it("returns false when any show key fails (AND semantics)", () => {
    const param = {
      displayOptions: { show: { mode: ["id"], enabled: [true] } },
    };
    expect(isVisible(param, { mode: "id", enabled: false })).toBe(false);
    expect(isVisible(param, { mode: "id", enabled: true })).toBe(true);
  });

  it("show + hide together: both must be satisfied", () => {
    const param = {
      displayOptions: {
        show: { mode: ["id"] },
        hide: { advanced: [true] },
      },
    };
    expect(isVisible(param, { mode: "id", advanced: false })).toBe(true);
    expect(isVisible(param, { mode: "id", advanced: true })).toBe(false);
    expect(isVisible(param, { mode: "url", advanced: false })).toBe(false);
  });

  it("treats missing currentValues key as not-in-list for show", () => {
    const param = { displayOptions: { show: { mode: ["id"] } } };
    expect(isVisible(param, {})).toBe(false);
  });
});
