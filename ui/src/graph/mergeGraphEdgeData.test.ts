// Copyright GraphCaster. All Rights Reserved.

import { describe, expect, it } from "vitest";

import { mergeGraphEdgeData, type EdgeDataPatch } from "./mergeGraphEdgeData";

describe("mergeGraphEdgeData", () => {
  it("sets routeDescription only", () => {
    expect(mergeGraphEdgeData(undefined, { routeDescription: "hello" })).toEqual({
      routeDescription: "hello",
    });
  });

  it("sets port kinds only", () => {
    expect(
      mergeGraphEdgeData(undefined, { sourcePortKind: "json", targetPortKind: "primitive" }),
    ).toEqual({
      sourcePortKind: "json",
      targetPortKind: "primitive",
    });
  });

  it("merges routeDescription with existing port overrides", () => {
    expect(
      mergeGraphEdgeData(
        { sourcePortKind: "json", targetPortKind: "json" },
        { routeDescription: "branch" },
      ),
    ).toEqual({
      routeDescription: "branch",
      sourcePortKind: "json",
      targetPortKind: "json",
    });
  });

  it("clearing routeDescription does not remove port overrides", () => {
    expect(
      mergeGraphEdgeData(
        { routeDescription: "old", sourcePortKind: "json" },
        { routeDescription: "" },
      ),
    ).toEqual({
      sourcePortKind: "json",
    });
  });

  it("null removes port override and keeps routeDescription", () => {
    expect(
      mergeGraphEdgeData(
        { routeDescription: "x", targetPortKind: "primitive" },
        { targetPortKind: null },
      ),
    ).toEqual({
      routeDescription: "x",
    });
  });

  it("returns undefined when nothing left", () => {
    expect(mergeGraphEdgeData(undefined, { routeDescription: "" })).toBeUndefined();
    expect(mergeGraphEdgeData({ routeDescription: "a" }, { routeDescription: "" })).toBeUndefined();
  });

  it("truncates routeDescription to 1024", () => {
    const long = "x".repeat(1100);
    const out = mergeGraphEdgeData(undefined, { routeDescription: long });
    expect(out?.routeDescription?.length).toBe(1024);
  });

  it("ignores unknown keys on prev", () => {
    const prev = { routeDescription: "r", extra: 1 } as Record<string, unknown>;
    expect(mergeGraphEdgeData(prev as never, { sourcePortKind: "any" })).toEqual({
      routeDescription: "r",
      sourcePortKind: "any",
    });
  });

  it("drops invalid sourcePortKind on prev (coerce)", () => {
    expect(
      mergeGraphEdgeData({ sourcePortKind: "not-a-kind" } as Record<string, unknown> as never, {}),
    ).toBeUndefined();
  });

  it("invalid port kind in patch removes override", () => {
    const bogusPatch = { sourcePortKind: "bogus" } as unknown as EdgeDataPatch;
    expect(mergeGraphEdgeData({ sourcePortKind: "json" }, bogusPatch)).toBeUndefined();
    expect(mergeGraphEdgeData({ routeDescription: "x" }, bogusPatch)).toEqual({
      routeDescription: "x",
    });
  });
});
