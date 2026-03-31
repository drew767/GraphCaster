// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import { GraphCasterEmbed, loadGraph } from "./index";

describe("GraphCasterEmbed.loadGraph", () => {
  it("returns invalid_json for malformed JSON string", () => {
    const r = loadGraph("{");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("invalid_json");
    }
  });

  it("parses valid JSON string via namespace", () => {
    const r = GraphCasterEmbed.loadGraph('{"nodes":[],"edges":[]}');
    expect(r.ok).toBe(true);
  });

  it("delegates object input to parseGraphDocumentJsonResult", () => {
    const r = loadGraph({ nodes: [], edges: [] });
    expect(r.ok).toBe(true);
  });
});
