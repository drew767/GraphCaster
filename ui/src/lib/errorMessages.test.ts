// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import { gcErrorTranslationKey } from "./errorMessages";

describe("gcErrorTranslationKey", () => {
  it("prefixes gc code with app.errors.gc", () => {
    expect(gcErrorTranslationKey("GC2001")).toBe("app.errors.gc.GC2001");
    expect(gcErrorTranslationKey("GC3010")).toBe("app.errors.gc.GC3010");
  });
});
