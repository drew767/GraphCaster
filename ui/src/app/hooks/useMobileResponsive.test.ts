// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useMobileResponsive } from "./useMobileResponsive";

type Listener = (e: MediaQueryListEvent) => void;

interface MockMQL extends MediaQueryList {
  _listeners: Set<Listener>;
  _set: (matches: boolean) => void;
}

function setupMatchMedia(initial: boolean): MockMQL {
  const listeners = new Set<Listener>();
  const mql = {
    matches: initial,
    media: "(max-width: 768px)",
    onchange: null,
    _listeners: listeners,
    addEventListener: (_: string, l: Listener) => {
      listeners.add(l);
    },
    removeEventListener: (_: string, l: Listener) => {
      listeners.delete(l);
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
    _set(matches: boolean) {
      this.matches = matches;
      for (const l of listeners) {
        l({ matches } as MediaQueryListEvent);
      }
    },
  } as unknown as MockMQL;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockReturnValue(mql),
  });
  return mql;
}

beforeEach(() => {
  // reset matchMedia between tests
});

describe("useMobileResponsive", () => {
  it("returns initial matchMedia state", () => {
    setupMatchMedia(true);
    const { result } = renderHook(() => useMobileResponsive());
    expect(result.current).toBe(true);
  });

  it("updates when matchMedia change fires", () => {
    const mql = setupMatchMedia(false);
    const { result } = renderHook(() => useMobileResponsive());
    expect(result.current).toBe(false);
    act(() => {
      mql._set(true);
    });
    expect(result.current).toBe(true);
  });
});
