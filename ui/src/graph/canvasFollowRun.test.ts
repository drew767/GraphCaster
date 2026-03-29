// Copyright GraphCaster. All Rights Reserved.

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FOLLOW_RUN_STORAGE_KEY,
  readFollowRunPreference,
  writeFollowRunPreference,
} from "./canvasFollowRun";

describe("canvasFollowRun", () => {
  const store: Record<string, string> = {};

  afterEach(() => {
    vi.unstubAllGlobals();
    Object.keys(store).forEach((k) => {
      delete store[k];
    });
  });

  function stubLs(): void {
    const ls = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
      clear: () => {
        Object.keys(store).forEach((k) => {
          delete store[k];
        });
      },
    } as Storage;
    vi.stubGlobal("window", { localStorage: ls });
  }

  it("defaults to false when unset", () => {
    stubLs();
    expect(readFollowRunPreference()).toBe(false);
  });

  it("persists true", () => {
    stubLs();
    writeFollowRunPreference(true);
    expect(store[FOLLOW_RUN_STORAGE_KEY]).toBe("1");
    expect(readFollowRunPreference()).toBe(true);
  });
});
