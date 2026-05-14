// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
  };
})();

Object.defineProperty(window, "localStorage", { value: localStorageMock });

const matchMediaMock = vi.fn().mockImplementation((query: string) => ({
  matches: query.includes("dark") ? false : false,
  media: query,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}));
Object.defineProperty(window, "matchMedia", { value: matchMediaMock });

describe("themeStore", () => {
  beforeEach(async () => {
    localStorageMock.clear();
    document.documentElement.removeAttribute("data-theme");
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("initialises with persisted theme from localStorage", async () => {
    localStorageMock.setItem("gc-theme", "dark");
    const { useThemeStore } = await import("./themeStore");
    const { result } = renderHook(() => useThemeStore());
    expect(result.current.theme).toBe("dark");
  });

  it("defaults to auto when no localStorage value", async () => {
    const { useThemeStore } = await import("./themeStore");
    const { result } = renderHook(() => useThemeStore());
    expect(result.current.theme).toBe("auto");
  });

  it("setTheme updates state and persists to localStorage", async () => {
    const { useThemeStore } = await import("./themeStore");
    const { result } = renderHook(() => useThemeStore());

    act(() => {
      result.current.setTheme("light");
    });

    expect(result.current.theme).toBe("light");
    expect(localStorageMock.getItem("gc-theme")).toBe("light");
  });

  it("effective returns light or dark (resolves auto via matchMedia)", async () => {
    const { useThemeStore } = await import("./themeStore");
    const { result } = renderHook(() => useThemeStore());

    act(() => {
      result.current.setTheme("light");
    });
    expect(result.current.effective()).toBe("light");

    act(() => {
      result.current.setTheme("dark");
    });
    expect(result.current.effective()).toBe("dark");
  });
});
