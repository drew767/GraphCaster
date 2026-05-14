// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import {
  useAutosave,
  AUTOSAVE_DEBOUNCE_MS,
  LARGE_GRAPH_THROTTLE_MS,
} from "./useAutosave";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useAutosave — debounce", () => {
  it("fires once after debounce window", () => {
    const save = vi.fn();
    const value = { count: 0 };
    const { result } = renderHook(() =>
      useAutosave({ getValue: () => value, save }),
    );

    act(() => {
      result.current.schedule();
    });
    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(save).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("default debounce is at least 2000ms", () => {
    expect(AUTOSAVE_DEBOUNCE_MS).toBeGreaterThanOrEqual(2000);
  });

  it("resets the window on repeated schedule()", () => {
    const save = vi.fn();
    const { result } = renderHook(() =>
      useAutosave({ getValue: () => 1, save }),
    );

    act(() => result.current.schedule());
    act(() => vi.advanceTimersByTime(1500));
    act(() => result.current.schedule());
    act(() => vi.advanceTimersByTime(1500));
    expect(save).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(600));
    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe("useAutosave — large-graph throttle", () => {
  it("respects 5s throttle when nodeCount > 50", async () => {
    const save = vi.fn();
    let nodeCount = 100;
    const { result, rerender } = renderHook(
      ({ nc }: { nc: number }) =>
        useAutosave({ getValue: () => 1, save, nodeCount: nc }),
      { initialProps: { nc: nodeCount } },
    );

    // First save fires at debounce (2s).
    act(() => result.current.schedule());
    act(() => vi.advanceTimersByTime(2100));
    expect(save).toHaveBeenCalledTimes(1);

    // Schedule again immediately — must wait at least throttleMs since last.
    act(() => result.current.schedule());
    act(() => vi.advanceTimersByTime(2100));
    expect(save).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(LARGE_GRAPH_THROTTLE_MS));
    expect(save).toHaveBeenCalledTimes(2);

    nodeCount = 10;
    rerender({ nc: nodeCount });
  });
});

describe("useAutosave — flush / cancel", () => {
  it("flush fires immediately and clears pending", () => {
    const save = vi.fn();
    const { result } = renderHook(() => useAutosave({ getValue: () => 1, save }));
    act(() => result.current.schedule());
    act(() => result.current.flush());
    expect(save).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(5000));
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("cancel drops the pending save", () => {
    const save = vi.fn();
    const { result } = renderHook(() => useAutosave({ getValue: () => 1, save }));
    act(() => result.current.schedule());
    act(() => result.current.cancel());
    act(() => vi.advanceTimersByTime(5000));
    expect(save).not.toHaveBeenCalled();
  });
});
