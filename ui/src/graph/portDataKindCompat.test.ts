// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import { classifyPortKindPair } from "./portDataKindCompat";

describe("classifyPortKindPair", () => {
  it("any pairs with anything as ok", () => {
    expect(classifyPortKindPair("any", "json")).toBe("ok");
    expect(classifyPortKindPair("json", "any")).toBe("ok");
    expect(classifyPortKindPair("any", "primitive")).toBe("ok");
  });

  it("same non-any kinds are ok", () => {
    expect(classifyPortKindPair("json", "json")).toBe("ok");
    expect(classifyPortKindPair("primitive", "primitive")).toBe("ok");
  });

  it("json vs primitive is warn either order", () => {
    expect(classifyPortKindPair("json", "primitive")).toBe("warn");
    expect(classifyPortKindPair("primitive", "json")).toBe("warn");
  });
});
