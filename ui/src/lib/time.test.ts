// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import { formatRelative } from "./time";

describe("formatRelative", () => {
  const NOW = 1_700_000_000_000;

  it("returns just-now text when within a minute", () => {
    expect(formatRelative(NOW - 5_000, { now: NOW })).toBe("just now");
  });

  it("respects custom just-now label", () => {
    expect(formatRelative(NOW - 5_000, { now: NOW, justNow: "только что" })).toBe(
      "только что",
    );
  });

  it("returns minutes for diffs under an hour", () => {
    expect(formatRelative(NOW - 5 * 60 * 1000, { now: NOW })).toBe("5m ago");
  });

  it("returns hours for diffs under a day", () => {
    expect(formatRelative(NOW - 3 * 3600 * 1000, { now: NOW })).toBe("3h ago");
  });

  it("returns days for diffs under a week", () => {
    expect(formatRelative(NOW - 2 * 86400 * 1000, { now: NOW })).toBe("2d ago");
  });

  it("returns weeks for older entries", () => {
    expect(formatRelative(NOW - 30 * 86400 * 1000, { now: NOW })).toBe("4w ago");
  });

  it("handles future timestamps gracefully", () => {
    expect(formatRelative(NOW + 10_000, { now: NOW })).toBe("just now");
  });
});
