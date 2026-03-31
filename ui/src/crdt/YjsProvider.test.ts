// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import { createGraphYDoc } from "./YjsProvider";

describe("createGraphYDoc", () => {
  it("initializes nodes, edges, and meta containers", () => {
    const doc = createGraphYDoc();
    expect(doc.getMap("nodes").size).toBe(0);
    expect(doc.getArray("edges").length).toBe(0);
    expect(doc.getMap("meta").size).toBe(0);
  });
});
