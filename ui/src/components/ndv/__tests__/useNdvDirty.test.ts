// Copyright GraphCaster. All Rights Reserved.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

import { useNdvDirty } from "../useNdvDirty";

describe("useNdvDirty", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with dirty=false and no errors", () => {
    const { result } = renderHook(() => useNdvDirty());
    expect(result.current.dirty).toBe(false);
    expect(result.current.errors).toEqual({});
  });

  it("markDirty sets dirty to true", () => {
    const { result } = renderHook(() => useNdvDirty());
    act(() => {
      result.current.markDirty();
    });
    expect(result.current.dirty).toBe(true);
  });

  it("markClean clears dirty flag and errors", () => {
    const { result } = renderHook(() => useNdvDirty());

    act(() => {
      result.current.markDirty();
      result.current.setError("field.a", "required");
    });
    expect(result.current.dirty).toBe(true);
    expect(result.current.errors).toEqual({ "field.a": "required" });

    act(() => {
      result.current.markClean();
    });
    expect(result.current.dirty).toBe(false);
    expect(result.current.errors).toEqual({});
  });

  it("setError tracks and removes per-path errors", () => {
    const { result } = renderHook(() => useNdvDirty());

    act(() => {
      result.current.setError("a.b", "too short");
      result.current.setError("a.c", "invalid");
    });
    expect(result.current.errors).toEqual({ "a.b": "too short", "a.c": "invalid" });

    act(() => {
      result.current.setError("a.b", null);
    });
    expect(result.current.errors).toEqual({ "a.c": "invalid" });

    act(() => {
      result.current.setError("a.c", null);
    });
    expect(result.current.errors).toEqual({});
  });

  it("triggers autosave callback after 500ms debounce", () => {
    const onAutosave = vi.fn();
    const { result } = renderHook(() => useNdvDirty(onAutosave));

    act(() => {
      result.current.markDirty();
    });
    expect(onAutosave).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(onAutosave).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onAutosave).toHaveBeenCalledOnce();
  });
});
