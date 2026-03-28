// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import { safeExternalHttpUrl } from "./safeExternalUrl";

describe("safeExternalHttpUrl", () => {
  it("returns null for non-string and empty", () => {
    expect(safeExternalHttpUrl(null)).toBeNull();
    expect(safeExternalHttpUrl(1)).toBeNull();
    expect(safeExternalHttpUrl("  ")).toBeNull();
  });

  it("accepts http and https", () => {
    expect(safeExternalHttpUrl("https://example.com/path?q=1")).toBe("https://example.com/path?q=1");
    expect(safeExternalHttpUrl(" http://localhost:8080/ ")).toBe("http://localhost:8080/");
  });

  it("rejects javascript and other schemes", () => {
    expect(safeExternalHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeExternalHttpUrl("file:///etc/passwd")).toBeNull();
    expect(safeExternalHttpUrl("data:text/html,<x>")).toBeNull();
  });

  it("rejects invalid URL", () => {
    expect(safeExternalHttpUrl("not a url")).toBeNull();
  });
});
