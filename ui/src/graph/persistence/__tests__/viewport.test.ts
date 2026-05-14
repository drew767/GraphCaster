// Copyright GraphCaster. All Rights Reserved.

import { beforeEach, describe, expect, it } from "vitest";

import { clearViewport, loadViewport, saveViewport } from "../viewport";

describe("viewport persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("saves and loads a valid viewport", () => {
    saveViewport("wf-1", { x: 12, y: -34, zoom: 1.25 });
    const loaded = loadViewport("wf-1");
    expect(loaded).toEqual({ x: 12, y: -34, zoom: 1.25 });
  });

  it("returns null for missing entries", () => {
    expect(loadViewport("absent")).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    window.localStorage.setItem("gc.viewport.bad", "{not json");
    expect(loadViewport("bad")).toBeNull();
  });

  it("returns null when JSON parses but has wrong shape", () => {
    window.localStorage.setItem("gc.viewport.shape", JSON.stringify({ x: "0", y: 0, zoom: 1 }));
    expect(loadViewport("shape")).toBeNull();
  });

  it("returns null when zoom is non-positive", () => {
    window.localStorage.setItem(
      "gc.viewport.bad-zoom",
      JSON.stringify({ x: 0, y: 0, zoom: 0 }),
    );
    expect(loadViewport("bad-zoom")).toBeNull();
  });

  it("ignores save when workflowId is empty", () => {
    saveViewport("", { x: 1, y: 2, zoom: 1 });
    expect(window.localStorage.length).toBe(0);
  });

  it("ignores save when viewport has non-finite values", () => {
    saveViewport("wf-bad", { x: Number.NaN, y: 0, zoom: 1 });
    expect(loadViewport("wf-bad")).toBeNull();
  });

  it("clears stored viewport", () => {
    saveViewport("wf-clr", { x: 1, y: 2, zoom: 1 });
    clearViewport("wf-clr");
    expect(loadViewport("wf-clr")).toBeNull();
  });

  it("keeps separate entries per workflowId", () => {
    saveViewport("a", { x: 1, y: 1, zoom: 1 });
    saveViewport("b", { x: 2, y: 2, zoom: 2 });
    expect(loadViewport("a")).toEqual({ x: 1, y: 1, zoom: 1 });
    expect(loadViewport("b")).toEqual({ x: 2, y: 2, zoom: 2 });
  });
});
