// Copyright GraphCaster. All Rights Reserved.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EDGE_LABELS_STORAGE_KEY,
  readEdgeLabelsEnabled,
  writeEdgeLabelsEnabled,
} from "./canvasEdgeLabels";

describe("canvasEdgeLabels", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("readEdgeLabelsEnabled is true when window is undefined", () => {
    vi.stubGlobal("window", undefined);
    expect(readEdgeLabelsEnabled()).toBe(true);
  });

  it("defaults to true when storage key is absent", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
      },
    });
    expect(readEdgeLabelsEnabled()).toBe(true);
  });

  it("persists off and reads back false", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
      },
    });
    writeEdgeLabelsEnabled(false);
    expect(store.get(EDGE_LABELS_STORAGE_KEY)).toBe("0");
    expect(readEdgeLabelsEnabled()).toBe(false);
    writeEdgeLabelsEnabled(true);
    expect(readEdgeLabelsEnabled()).toBe(true);
  });
});
