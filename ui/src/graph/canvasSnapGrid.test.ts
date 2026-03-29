// Copyright GraphCaster. All Rights Reserved.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CANVAS_GRID_STEP,
  readSnapGridEnabled,
  SNAP_GRID_STORAGE_KEY,
  writeSnapGridEnabled,
} from "./canvasSnapGrid";

describe("canvasSnapGrid", () => {
  const store: Record<string, string> = {};

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.keys(store).forEach((k) => {
      delete store[k];
    });
  });

  it("exports grid step 16", () => {
    expect(CANVAS_GRID_STEP).toBe(16);
  });

  it("readSnapGridEnabled is false without localStorage key", () => {
    const ls = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
    } as Storage;
    vi.stubGlobal("window", { localStorage: ls });
    expect(readSnapGridEnabled()).toBe(false);
  });

  it("write then read round-trips", () => {
    const ls = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
    } as Storage;
    vi.stubGlobal("window", { localStorage: ls });
    writeSnapGridEnabled(true);
    expect(store[SNAP_GRID_STORAGE_KEY]).toBe("1");
    expect(readSnapGridEnabled()).toBe(true);
    writeSnapGridEnabled(false);
    expect(readSnapGridEnabled()).toBe(false);
  });
});
