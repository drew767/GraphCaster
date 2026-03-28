// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import { parseRunEventLine } from "./parseRunEventLine";
import {
  applyParsedRunEventToOverlayState,
  nodeRunOverlayMapsEqual,
  reduceRunEventsToNodeOverlay,
} from "./nodeRunOverlay";

describe("nodeRunOverlayMapsEqual", () => {
  it("returns true for the same reference", () => {
    const m = { a: { phase: "running" as const, lastType: "x" } };
    expect(nodeRunOverlayMapsEqual(m, m)).toBe(true);
  });

  it("returns true for empty vs undefined", () => {
    expect(nodeRunOverlayMapsEqual({}, undefined)).toBe(true);
    expect(nodeRunOverlayMapsEqual(undefined, {})).toBe(true);
  });

  it("returns false when phase differs", () => {
    const a = { n1: { phase: "running" as const, lastType: "node_enter" } };
    const b = { n1: { phase: "success" as const, lastType: "node_enter" } };
    expect(nodeRunOverlayMapsEqual(a, b)).toBe(false);
  });

  it("returns false when key set differs", () => {
    const a = { n1: { phase: "running" as const, lastType: "(" } };
    const b = { ...a, n2: { phase: "running" as const, lastType: "(" } };
    expect(nodeRunOverlayMapsEqual(a, b)).toBe(false);
  });
});

describe("overlay batching / no-op updates", () => {
  it("two identical node_enter lines keep the same map content (phases stable)", () => {
    const line = '{"type":"node_enter","nodeId":"t1","nodeType":"task","graphId":"g"}';
    const ev = parseRunEventLine(line);
    expect(ev).not.toBeNull();
    const once = applyParsedRunEventToOverlayState({}, ev as Record<string, unknown>);
    const twice = applyParsedRunEventToOverlayState(once, ev as Record<string, unknown>);
    expect(twice).toBe(once);
    expect(nodeRunOverlayMapsEqual(once, twice)).toBe(true);
  });

  it("reduceRunEventsToNodeOverlay matches incremental apply for the same stream", () => {
    const lines = [
      '{"type":"node_enter","nodeId":"t1","nodeType":"task","graphId":"g"}',
      '{"type":"node_exit","nodeId":"t1","nodeType":"task","graphId":"g"}',
    ];
    const evs = lines
      .map((l) => parseRunEventLine(l))
      .filter((x): x is Record<string, unknown> => x != null && typeof x === "object" && !Array.isArray(x));
    let acc = {};
    for (const o of evs) {
      acc = applyParsedRunEventToOverlayState(acc, o);
    }
    const reduced = reduceRunEventsToNodeOverlay(evs);
    expect(nodeRunOverlayMapsEqual(acc, reduced)).toBe(true);
  });
});
